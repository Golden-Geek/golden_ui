import type { ParamValue } from '$lib/golden_ui/types';
import WatcherColorVisualizer from './WatcherColorVisualizer.svelte';
import WatcherEventVisualizer from './WatcherEventVisualizer.svelte';
import WatcherValueVisualizer from './WatcherValueVisualizer.svelte';

export type WatcherVisualizerId = 'value' | 'events' | 'color';

export interface WatcherVisualizerEntry {
	id: WatcherVisualizerId;
	label: string;
	component: any;
	supportsRangeMode: boolean;
}

const valueVisualizer: WatcherVisualizerEntry = {
	id: 'value',
	label: 'Value Curves',
	component: WatcherValueVisualizer,
	supportsRangeMode: true
};

const eventsVisualizer: WatcherVisualizerEntry = {
	id: 'events',
	label: 'Change Timeline',
	component: WatcherEventVisualizer,
	supportsRangeMode: false
};

const colorVisualizer: WatcherVisualizerEntry = {
	id: 'color',
	label: 'Color Gradient',
	component: WatcherColorVisualizer,
	supportsRangeMode: false
};

export const watcherVisualizerRegistry: Record<ParamValue['kind'], WatcherVisualizerEntry> = {
	trigger: eventsVisualizer,
	int: valueVisualizer,
	float: valueVisualizer,
	str: eventsVisualizer,
	enum: eventsVisualizer,
	bool: eventsVisualizer,
	vec2: valueVisualizer,
	vec3: valueVisualizer,
	color: colorVisualizer,
	reference: eventsVisualizer
};
