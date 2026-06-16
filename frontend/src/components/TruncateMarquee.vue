<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
	text: {
		type: [String, Number],
		default: '',
	},
	as: {
		type: String,
		default: 'span',
	},
});

const containerRef = ref(null);
const textRef = ref(null);
const trackRef = ref(null);
const marqueeDistance = ref(0);
let resizeObserver = null;
let marqueeAnimation = null;

const PAUSE_MS = 3000;
const MARQUEE_SPEED = 42;

const textValue = computed(() => String(props.text || ''));
const isOverflowing = computed(() => marqueeDistance.value > 0);

function clearMarqueeCycle() {
	if (marqueeAnimation) {
		marqueeAnimation.cancel();
		marqueeAnimation = null;
	}
}

function resetTrack() {
	if (!trackRef.value) return;
	trackRef.value.style.transform = 'translateX(0)';
}

function prefersReducedMotion() {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function scheduleMarqueeCycle() {
	clearMarqueeCycle();

	if (!isOverflowing.value || prefersReducedMotion()) {
		resetTrack();
		return;
	}

	resetTrack();
	const scrollDuration = Math.max(600, (marqueeDistance.value / MARQUEE_SPEED) * 1000);
	const totalDuration = PAUSE_MS + scrollDuration + PAUSE_MS;
	const startScrollOffset = PAUSE_MS / totalDuration;
	const endScrollOffset = (PAUSE_MS + scrollDuration) / totalDuration;

	marqueeAnimation = trackRef.value.animate(
		[
			{ transform: 'translateX(0)', offset: 0 },
			{ transform: 'translateX(0)', offset: startScrollOffset },
			{ transform: `translateX(-${marqueeDistance.value}px)`, offset: endScrollOffset },
			{ transform: `translateX(-${marqueeDistance.value}px)`, offset: 1 },
		],
		{
			duration: totalDuration,
			easing: 'linear',
			iterations: Infinity,
		},
	);
}

function updateMarqueeDistance() {
	const container = containerRef.value;
	const text = textRef.value;
	if (!container || !text) return;

	const distance = Math.ceil(text.scrollWidth - container.clientWidth);
	marqueeDistance.value = Math.max(0, distance);
}

watch(textValue, async () => {
	await nextTick();
	updateMarqueeDistance();
	scheduleMarqueeCycle();
});

watch(marqueeDistance, () => {
	scheduleMarqueeCycle();
});

onMounted(async () => {
	await nextTick();
	updateMarqueeDistance();
	scheduleMarqueeCycle();

	// Observe only the container for layout changes. The expensive part — the
	// infinite Element.animate cycle — is created lazily by scheduleMarqueeCycle
	// and ONLY when the text actually overflows its box, so the common case
	// (text that fits) attaches no animation at all. Content changes are handled
	// by the textValue watcher, so observing the inner text node too would be
	// redundant work multiplied across the hundreds of marquees a list renders.
	resizeObserver = new ResizeObserver(updateMarqueeDistance);
	if (containerRef.value) resizeObserver.observe(containerRef.value);
});

onBeforeUnmount(() => {
	clearMarqueeCycle();
	resizeObserver?.disconnect();
});
</script>

<template>
	<component
		:is="props.as"
		ref="containerRef"
		class="truncate-marquee"
		:class="{ 'is-overflowing': isOverflowing }"
		:title="textValue"
	>
		<span ref="trackRef" class="truncate-marquee__track">
			<span ref="textRef" class="truncate-marquee__text">{{ props.text }}</span>
		</span>
	</component>
</template>
