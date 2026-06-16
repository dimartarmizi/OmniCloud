<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { IconStarFilled } from "@tabler/icons-vue";
import TruncateMarquee from "./TruncateMarquee.vue";
import {
  formatBytes,
  formatDate,
  getModifiedTime,
  providerIcon,
  providerLabel,
} from "../composables/useFormatFile.js";
import { getFileIcon } from "../composables/useFileType.js";

const { t } = useI18n();

const props = defineProps({
  item: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  nameField: { type: String, default: "file_name" },
  showStar: { type: Boolean, default: true },
  highlighted: { type: Boolean, default: false },
});

const emit = defineEmits(["select", "open", "contextmenu"]);

const displayName = computed(() => {
  if (props.nameField === "display_name") {
    return props.item.display_name || props.item.file_name || "";
  }
  return props.item[props.nameField] || "";
});

function handleClick(event) {
  emit("select", event);
}

function handleDblClick(event) {
  emit("open", event);
}

function handleContextMenu(event) {
  emit("contextmenu", event);
}

// Keyboard operability: Enter/Space opens the item (same as double-click).
function handleKeydown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("open", event);
  }
}
</script>

<template>
  <div
    class="group select-none rounded-[12px] border p-4 transition hover:-translate-y-0.5 hover:border-[#d2e3fc] hover:shadow-[0_10px_30px_rgba(32,33,36,0.08)] dark:hover:border-slate-500"
    :class="
      selected
        ? 'border-[#1a73e8] bg-gradient-to-br from-[#e8f0fe] to-[#f8fbff] shadow-[0_14px_34px_rgba(26,115,232,0.14)] dark:border-sky-400 dark:from-sky-500/15 dark:to-slate-800'
        : highlighted
          ? 'border-amber-400 bg-gradient-to-br from-amber-50 to-[#fffdf5] shadow-[0_14px_34px_rgba(245,158,11,0.14)] dark:border-amber-300 dark:from-amber-400/15 dark:to-slate-800'
          : 'border-[#e0e3e7] bg-white dark:border-slate-700 dark:bg-slate-800'
    "
    :data-file-id="item.id"
    role="button"
    tabindex="0"
    :aria-label="displayName"
    @click="handleClick"
    @dblclick="handleDblClick"
    @keydown="handleKeydown"
    @contextmenu="handleContextMenu"
  >
    <div class="flex w-full flex-col items-start gap-4 text-left">
      <div class="flex w-full items-start justify-between gap-3">
        <div
          class="grid size-12 place-items-center rounded-2xl transition"
          :class="
            selected
              ? 'bg-[#d3e3fd] text-[#1a73e8] shadow-inner dark:bg-sky-500/20 dark:text-sky-300'
              : highlighted
                ? 'bg-amber-100 text-amber-500 shadow-inner dark:bg-amber-400/20 dark:text-amber-300'
                : 'bg-[#f1f3f4] text-[#5f6368] dark:bg-slate-700 dark:text-slate-300'
          "
        >
          <component
            :is="getFileIcon(item, selected || highlighted)"
            :size="22"
            :stroke="selected || highlighted ? 0 : 1.8"
            class="transition-transform duration-200 group-hover:scale-110"
          />
        </div>
        <IconStarFilled
          v-if="showStar && item.is_starred && item.capabilities?.starred"
          :size="16"
          :stroke="0"
          class="shrink-0 text-amber-400"
        />
      </div>
      <div class="min-w-0">
        <TruncateMarquee
          as="p"
          class="text-sm font-semibold text-[#202124] dark:text-slate-100"
          :text="displayName"
        />
        <div
          class="mt-1 flex min-w-0 items-center gap-2 text-xs text-[#5f6368] dark:text-slate-400"
        >
          <div
            v-if="providerIcon(item.provider)"
            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white dark:bg-slate-900/70"
          >
            <img
              :src="providerIcon(item.provider)"
              :alt="providerLabel(item.provider)"
              class="size-3.5 object-contain"
            />
          </div>
          <TruncateMarquee
            as="p"
            class="min-w-0"
            :text="item.email || t('drive.noOwner')"
          />
        </div>
      </div>
      <div
        class="flex w-full items-center justify-between text-xs text-[#5f6368] dark:text-slate-400"
      >
        <span>{{ formatDate(getModifiedTime(item)) }}</span>
        <span>{{
          item.is_folder ? t("drive.folder") : formatBytes(item.size)
        }}</span>
      </div>
    </div>
  </div>
</template>
