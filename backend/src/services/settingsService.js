import { db } from '../config/database.js';

const VALID_KEYS = ['language', 'theme'];

export function getSettings(userId) {
	const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
	const settings = {};

	for (const row of rows) {
		settings[row.key] = row.value;
	}

	return settings;
}

export function setSetting(userId, key, value) {
	if (!VALID_KEYS.includes(key)) {
		throw new Error(`Invalid setting key: ${key}`);
	}

	const stmt = db.prepare(`
		INSERT INTO user_settings (id, user_id, key, value, updated_at)
		VALUES (lower(hex(randomblob(16))), ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id, key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`);

	stmt.run(userId, key, value);
	return { key, value };
}

export function updateSettings(userId, settings) {
	const results = {};

	for (const [key, value] of Object.entries(settings)) {
		if (VALID_KEYS.includes(key)) {
			setSetting(userId, key, value);
			results[key] = value;
		}
	}

	return results;
}
