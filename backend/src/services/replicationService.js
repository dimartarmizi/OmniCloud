import { db } from '../config/database.js';
import { getSetting } from './settingsService.js';
import { getOrderedActiveAccounts } from './allocationService.js';
import { getAccountById, updateAccountUsage } from './accountService.js';
import { createAdapter } from './adapterRegistry.js';

let isProcessing = false;

// Saving file ID being processed to avoid duplicate processing
const activeReplications = new Set();

/**
 * Selecting the best account to store a new file replica.
 * Target accounts must be active, have enough remaining space,
 * and haven't stored a part of this file yet. Prioritize different providers.
 */
function selectTargetAccountForReplication(userId, fileMetadataId, fileSize) {
	// Get accounts that already store parts of this file
	const existingAccountIds = db
		.prepare('SELECT cloud_account_id FROM file_parts WHERE file_metadata_id = ?')
		.all(fileMetadataId)
		.map((r) => r.cloud_account_id);

	const activeAccounts = getOrderedActiveAccounts(userId);

	// Filter candidates accounts that do not store this file and have capacity
	const candidates = activeAccounts.filter((account) => {
		if (existingAccountIds.includes(account.id)) return false;
		const freeSpace = Number(account.total_space || 0) - Number(account.used_space || 0);
		return freeSpace >= fileSize;
	});

	if (candidates.length === 0) return null;

	// Prioritize accounts with different providers than those already existing (for cross-provider resilience)
	const existingProviders = activeAccounts
		.filter((account) => existingAccountIds.includes(account.id))
		.map((account) => account.provider);

	const differentProviderCandidates = candidates.filter((c) => !existingProviders.includes(c.provider));
	const pool = differentProviderCandidates.length > 0 ? differentProviderCandidates : candidates;

	// Select the account with the largest free space
	return pool.sort((a, b) => {
		const freeA = Number(a.total_space || 0) - Number(a.used_space || 0);
		const freeB = Number(b.total_space || 0) - Number(b.used_space || 0);
		return freeB - freeA;
	})[0];
}

/**
 * Update replication_status for a single file based on its current part count vs target.
 */
function updateReplicationStatus(fileId, replicationFactor) {
	const partsCount = db
		.prepare('SELECT COUNT(*) as count FROM file_parts WHERE file_metadata_id = ?')
		.get(fileId).count;

	let status;
	if (partsCount >= replicationFactor) {
		status = 'fully_protected';
	} else if (partsCount > 1) {
		status = 'partially_protected';
	} else {
		status = 'not_protected';
	}

	db.prepare('UPDATE file_metadata SET replication_status = ? WHERE id = ?').run(status, fileId);
	return status;
}

/**
 * Performing replication process for a specific file.
 */
async function replicateFile(file, replicationFactor) {
	if (activeReplications.has(file.id)) return;
	activeReplications.add(file.id);

	let targetAccount = null;
	let uploadResponse = null;

	try {
		// 1. Get healthy file parts (active accounts)
		const healthyParts = db
			.prepare(`
				SELECT fp.* 
				FROM file_parts fp
				INNER JOIN cloud_accounts ca ON ca.id = fp.cloud_account_id
				WHERE fp.file_metadata_id = ? AND ca.status = 'active'
			`)
			.all(file.id);

		if (healthyParts.length === 0) {
			console.warn(`[RAID] File "${file.file_name}" does not have active/healthy replicas to use as a source.`);
			return;
		}

		// If the number of healthy parts + remaining parts already reaches the target, no need to replicate further
		const totalParts = db.prepare('SELECT COUNT(*) as count FROM file_parts WHERE file_metadata_id = ?').get(file.id).count;
		if (totalParts >= replicationFactor) {
			// Ensure status is correct even if previously not updated
			updateReplicationStatus(file.id, replicationFactor);
			return;
		}

		// 2. Determine target account for new replica
		targetAccount = selectTargetAccountForReplication(file.user_id, file.id, file.size);
		if (!targetAccount) {
			console.warn(`[RAID] No target account meets the requirements for replication "${file.file_name}" (full capacity or all accounts already used).`);
			// Mark as partially protected if there's at least 1 part, else not_protected
			updateReplicationStatus(file.id, replicationFactor);
			return;
		}

		// 3. Use the first healthy part as the download source
		const sourcePart = healthyParts[0];
		const sourceAccount = getAccountById(file.user_id, sourcePart.cloud_account_id);
		if (!sourceAccount) {
			throw new Error('Source account not found');
		}

		const sourceAdapter = createAdapter(sourceAccount);
		const targetAdapter = createAdapter(targetAccount);

		// Resolve target remote parent ID BEFORE starting download stream
		// to avoid async delays causing download stream data loss (timing race condition)
		let targetParentId = null;
		if (typeof targetAdapter.ensureRemotePath === 'function') {
			targetParentId = await targetAdapter.ensureRemotePath(file.virtual_path);
		}

		console.log(`[RAID] Mereplikasi "${file.file_name}" (${(file.size / 1024 / 1024).toFixed(2)} MB):`);
		console.log(`       Sumber: ${sourceAccount.email} (${sourceAccount.provider})`);
		console.log(`       Target: ${targetAccount.email} (${targetAccount.provider})`);

		// Create file record for source adapter
		const sourceFileRecord = {
			...file,
			remote_file_id: sourcePart.remote_file_id,
			remote_parent_id: sourcePart.remote_parent_id,
		};

		// Start download stream
		const downloadStream = await sourceAdapter.getDownloadStream(sourceFileRecord);

		// Start upload to target adapter
		uploadResponse = await targetAdapter.uploadStream({
			stream: downloadStream,
			size: file.size,
			fileName: file.file_name,
			mimeType: file.mime_type,
			virtualPath: file.virtual_path,
			remoteParentId: targetParentId, // Use pre-resolved targetParentId
			onProgress: () => { }, // No need for real-time progress for background task
		});

		// Verify file still exists before inserting part
		const fileExists = db.prepare('SELECT id FROM file_metadata WHERE id = ?').get(file.id);
		if (!fileExists) {
			console.warn(`[RAID] File "${file.file_name}" no longer exists in database, skipping part registration.`);
			return;
		}

		// 4. Record the new part to the database
		db.prepare(`
			INSERT INTO file_parts (id, file_metadata_id, cloud_account_id, remote_file_id, remote_parent_id, part_index, part_size)
			VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 0, ?)
			ON CONFLICT(file_metadata_id, cloud_account_id, part_index) DO UPDATE SET
				remote_file_id = excluded.remote_file_id,
				remote_parent_id = excluded.remote_parent_id,
				part_size = excluded.part_size
		`).run(file.id, targetAccount.id, uploadResponse.remoteFileId, uploadResponse.remoteParentId, file.size);

		// 5. Update used quota in target account
		const nextUsedSpace = Number(targetAccount.used_space) + Number(file.size);
		updateAccountUsage(file.user_id, targetAccount.id, nextUsedSpace);

		// 6. Update replication_status based on new part count
		const newStatus = updateReplicationStatus(file.id, replicationFactor);
		console.log(`[RAID] File replication "${file.file_name}" to ${targetAccount.email} SUCCESS. Status: ${newStatus}`);
	} catch (error) {
		console.error(`[RAID] Gagal mereplikasi berkas "${file.file_name}":`, error);
		console.error(`       Detail parameter:`, {
			fileId: file?.id,
			fileName: file?.file_name,
			targetAccountId: targetAccount?.id,
			targetAccountEmail: targetAccount?.email,
			uploadResponse
		});
	} finally {
		activeReplications.delete(file.id);
	}
}

/**
 * Scanning files that require replication and processing them.
 */
export async function processReplications() {
	if (isProcessing) return;
	isProcessing = true;

	try {
		// Ambil semua user
		const users = db.prepare('SELECT id FROM users').all();

		for (const user of users) {
			const rawRepFactor = getSetting(user.id, 'replication_factor');
			const replicationFactor = Math.min(3, Math.max(1, Number(rawRepFactor || 1)));

			if (replicationFactor <= 1) continue;

			// Find user files whose part count is less than target replicationFactor
			const underReplicatedFiles = db
				.prepare(`
					SELECT fm.*
					FROM file_metadata fm
					LEFT JOIN (
						SELECT file_metadata_id, COUNT(*) as count
						FROM file_parts
						GROUP BY file_metadata_id
					) pc ON pc.file_metadata_id = fm.id
					WHERE fm.user_id = ?
						AND fm.is_folder = 0
						AND COALESCE(pc.count, 0) < ?
				`)
				.all(user.id, replicationFactor);

			// Process under-replicated files one by one
			for (const file of underReplicatedFiles) {
				await replicateFile(file, replicationFactor);
			}
		}
	} catch (error) {
		console.error('[RAID] Error while processing replication queue:', error);
	} finally {
		isProcessing = false;
	}
}

/**
 * Starting background replication worker loop.
 */
export function startReplicationService(intervalMs = 30000) {
	console.log(`[RAID] Background Replication Service active (interval: ${intervalMs / 1000}s).`);
	// Run the first scan asynchronously
	processReplications().catch((err) => console.error(err));

	// Schedule periodic scan
	setInterval(() => {
		processReplications().catch((err) => console.error(err));
	}, intervalMs);
}
