<script lang="ts">
	import { slide } from 'svelte/transition';
	import { appState } from '../../../../store/workbench.svelte';
	import {
		sendCreateUserItemByTypeIntent,
		sendSetParamIntent,
		createUiEditSession
	} from '../../../../store/ui-intents';
	import type { NodeId, ParamValue, UiNodeDto } from '../../../../types';
	import type { NodeInspectorComponentProps } from '../node-inspector-registry';
	import NodeInspector from '../NodeInspector.svelte';
	import SelectNodeButton from '../../../common/SelectNodeButton.svelte';
	import ColorPicker from '../../../common/ColorPicker.svelte';
	import { ColorUtil, type Color } from '../../../common/Color.svelte';

	let { node, level, defaultHeader, collapsed }: NodeInspectorComponentProps = $props();

	const GRADIENT_NODE_TYPE = 'gradient';
	const STOP_NODE_TYPE = 'gradient_stop';
	const STOP_ITEM_TYPE = 'gradient_stop';
	const DECL_POSITION = 'position';
	const DECL_COLOR = 'color';
	const DECL_INTERPOLATION = 'interpolation';
	const INTERPOLATIONS = ['none', 'linear', 'smooth'] as const;
	const SMOOTH_STEPS = 8;
	const DRAG_THRESHOLD_PX = 2;

	type Rgba = [number, number, number, number];
	type StopData = {
		id: NodeId;
		position: number;
		color: Rgba;
		interpolation: string;
		positionParamId: NodeId | null;
		colorParamId: NodeId | null;
		interpolationParamId: NodeId | null;
	};

	let session = $derived(appState.session);
	let graphNodesById = $derived(session?.graph.state.nodesById ?? null);
	let liveNode: UiNodeDto = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);

	let selected_stop_id = $state<NodeId | null>(null);
	let color_editor_stop_id = $state<NodeId | null>(null);
	let picker_color = $state<Color>({ r: 0, g: 0, b: 0, a: 1 });

	let trackEl: HTMLDivElement | null = $state(null);
	let dragStopId: NodeId | null = null;
	let dragPointerId: number | null = null;
	let dragStartX = 0;
	let dragMoved = false;
	let dragSession: ReturnType<typeof createUiEditSession> | null = null;

	const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

	const childParam = (parent: UiNodeDto, declId: string): UiNodeDto | null => {
		if (!graphNodesById) {
			return null;
		}
		for (const childId of parent.children) {
			const child = graphNodesById.get(childId);
			if (child?.decl_id === declId && child.data.kind === 'parameter') {
				return child;
			}
		}
		return null;
	};

	let stops = $derived.by((): StopData[] => {
		if (!graphNodesById || liveNode.node_type !== GRADIENT_NODE_TYPE) {
			return [];
		}
		const result: StopData[] = [];
		for (const childId of liveNode.children) {
			const child = graphNodesById.get(childId);
			if (!child || child.node_type !== STOP_NODE_TYPE) {
				continue;
			}
			const positionNode = childParam(child, DECL_POSITION);
			const colorNode = childParam(child, DECL_COLOR);
			const interpolationNode = childParam(child, DECL_INTERPOLATION);
			const positionValue = positionNode?.data.kind === 'parameter' ? positionNode.data.param.value : null;
			const colorValue = colorNode?.data.kind === 'parameter' ? colorNode.data.param.value : null;
			const interpolationValue =
				interpolationNode?.data.kind === 'parameter' ? interpolationNode.data.param.value : null;
			const position =
				positionValue?.kind === 'float' || positionValue?.kind === 'int' ? positionValue.value : 0;
			const color = (colorValue?.kind === 'color' ? colorValue.value : [0, 0, 0, 1]) as Rgba;
			const interpolation = interpolationValue?.kind === 'enum' ? interpolationValue.value : 'linear';
			result.push({
				id: child.node_id,
				position,
				color,
				interpolation,
				positionParamId: positionNode?.node_id ?? null,
				colorParamId: colorNode?.node_id ?? null,
				interpolationParamId: interpolationNode?.node_id ?? null
			});
		}
		result.sort((left, right) => left.position - right.position);
		return result;
	});

	let selected_stop_node = $derived.by((): UiNodeDto | null => {
		if (selected_stop_id === null) {
			return null;
		}
		return graphNodesById?.get(selected_stop_id) ?? null;
	});

	let stop_count_label = $derived(`${stops.length} stop${stops.length === 1 ? '' : 's'}`);

	const cssColor = (color: Rgba): string => {
		const r = Math.round(clamp01(color[0]) * 255);
		const g = Math.round(clamp01(color[1]) * 255);
		const b = Math.round(clamp01(color[2]) * 255);
		return `rgb(${r} ${g} ${b} / ${clamp01(color[3])})`;
	};

	const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount;
	const lerpColor = (start: Rgba, end: Rgba, amount: number): Rgba => [
		lerp(start[0], end[0], amount),
		lerp(start[1], end[1], amount),
		lerp(start[2], end[2], amount),
		lerp(start[3], end[3], amount)
	];
	const applyInterpolation = (interpolation: string, amount: number): number => {
		const t = clamp01(amount);
		if (interpolation === 'none') {
			return 0;
		}
		if (interpolation === 'smooth') {
			return t * t * (3 - 2 * t);
		}
		return t;
	};

	const sampleColorAt = (position: number): Rgba => {
		if (stops.length === 0) {
			return [0, 0, 0, 1];
		}
		if (position <= stops[0].position) {
			return stops[0].color;
		}
		const last = stops[stops.length - 1];
		if (position >= last.position) {
			return last.color;
		}
		for (let index = 1; index < stops.length; index += 1) {
			const left = stops[index - 1];
			const right = stops[index];
			if (position > right.position) {
				continue;
			}
			const span = Math.max(1e-9, right.position - left.position);
			const amount = applyInterpolation(left.interpolation, (position - left.position) / span);
			return lerpColor(left.color, right.color, amount);
		}
		return last.color;
	};

	// Interpolation-aware CSS preview: hard edges for `none`, sampled steps for `smooth`.
	let gradientCss = $derived.by((): string => {
		if (stops.length === 0) {
			return 'linear-gradient(to right, #000, #000)';
		}
		if (stops.length === 1) {
			const single = cssColor(stops[0].color);
			return `linear-gradient(to right, ${single}, ${single})`;
		}
		const percent = (value: number): string => `${(clamp01(value) * 100).toFixed(2)}%`;
		const parts: string[] = [`${cssColor(stops[0].color)} ${percent(stops[0].position)}`];
		for (let index = 1; index < stops.length; index += 1) {
			const left = stops[index - 1];
			const right = stops[index];
			if (left.interpolation === 'none') {
				parts.push(`${cssColor(left.color)} ${percent(right.position)}`);
			} else if (left.interpolation === 'smooth') {
				for (let step = 1; step < SMOOTH_STEPS; step += 1) {
					const t = step / SMOOTH_STEPS;
					const position = lerp(left.position, right.position, t);
					const color = lerpColor(left.color, right.color, applyInterpolation('smooth', t));
					parts.push(`${cssColor(color)} ${percent(position)}`);
				}
			}
			parts.push(`${cssColor(right.color)} ${percent(right.position)}`);
		}
		return `linear-gradient(to right, ${parts.join(', ')})`;
	});

	$effect(() => {
		if (stops.length === 0) {
			selected_stop_id = null;
			return;
		}
		if (selected_stop_id === null || !stops.some((stop) => stop.id === selected_stop_id)) {
			selected_stop_id = stops[0].id;
		}
	});

	$effect(() => {
		if (color_editor_stop_id !== null && !stops.some((stop) => stop.id === color_editor_stop_id)) {
			color_editor_stop_id = null;
		}
	});

	const positionFromClientX = (clientX: number): number => {
		if (!trackEl) {
			return 0;
		}
		const rect = trackEl.getBoundingClientRect();
		if (rect.width <= 0) {
			return 0;
		}
		return clamp01((clientX - rect.left) / rect.width);
	};

	const setStopPosition = (stop: StopData, position: number): void => {
		if (!stop.positionParamId) {
			return;
		}
		const value: ParamValue = { kind: 'float', value: clamp01(position) };
		void sendSetParamIntent(stop.positionParamId, value, 'Coalesce');
	};

	const cycleInterpolation = (stop: StopData): void => {
		if (!stop.interpolationParamId) {
			return;
		}
		const currentIndex = INTERPOLATIONS.indexOf(stop.interpolation as (typeof INTERPOLATIONS)[number]);
		const next = INTERPOLATIONS[(currentIndex + 1 + INTERPOLATIONS.length) % INTERPOLATIONS.length];
		const value: ParamValue = { kind: 'enum', value: next };
		void sendSetParamIntent(stop.interpolationParamId, value, 'Coalesce');
	};

	const openColorEditor = (stop: StopData): void => {
		selected_stop_id = stop.id;
		picker_color = ColorUtil.fromArray(stop.color);
		color_editor_stop_id = stop.id;
	};

	const applyPickerColor = (): void => {
		const stop = stops.find((entry) => entry.id === color_editor_stop_id);
		if (!stop?.colorParamId) {
			return;
		}
		const array = ColorUtil.toArray(picker_color);
		const value: ParamValue = {
			kind: 'color',
			value: [array[0] ?? 0, array[1] ?? 0, array[2] ?? 0, array[3] ?? 1]
		};
		void sendSetParamIntent(stop.colorParamId, value, 'Coalesce');
	};

	const addStopAt = async (position: number): Promise<void> => {
		const color = sampleColorAt(position);
		await sendCreateUserItemByTypeIntent(liveNode.node_id, STOP_ITEM_TYPE, 'Stop', {
			initial_params: [
				{ decl_id: DECL_POSITION, value: { kind: 'float', value: clamp01(position) } },
				{
					decl_id: DECL_COLOR,
					value: { kind: 'color', value: [color[0], color[1], color[2], color[3]] }
				}
			]
		});
	};

	const onHandlePointerDown = (event: PointerEvent, stop: StopData): void => {
		event.stopPropagation();
		event.preventDefault();
		selected_stop_id = stop.id;
		if (event.altKey) {
			cycleInterpolation(stop);
			return;
		}
		dragStopId = stop.id;
		dragPointerId = event.pointerId;
		dragStartX = event.clientX;
		dragMoved = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	};

	const onHandlePointerMove = (event: PointerEvent, stop: StopData): void => {
		if (dragStopId !== stop.id || dragPointerId !== event.pointerId) {
			return;
		}
		if (!dragMoved && Math.abs(event.clientX - dragStartX) < DRAG_THRESHOLD_PX) {
			return;
		}
		if (!dragMoved) {
			dragMoved = true;
			dragSession = createUiEditSession('Move gradient stop');
			void dragSession.begin();
		}
		setStopPosition(stop, positionFromClientX(event.clientX));
	};

	const onHandlePointerUp = (event: PointerEvent, stop: StopData): void => {
		if (dragStopId !== stop.id || dragPointerId !== event.pointerId) {
			return;
		}
		const element = event.currentTarget as HTMLElement;
		if (element.hasPointerCapture(event.pointerId)) {
			element.releasePointerCapture(event.pointerId);
		}
		if (dragMoved && dragSession) {
			void dragSession.end();
		}
		dragSession = null;
		dragStopId = null;
		dragPointerId = null;
		dragMoved = false;
	};

	const onTrackDoubleClick = (event: MouseEvent): void => {
		if (event.target !== trackEl) {
			return;
		}
		void addStopAt(positionFromClientX(event.clientX));
	};
</script>

{#snippet gradientHeaderExtra()}
	<span class="gradient-stop-pill">{stop_count_label}</span>
	{#if level > 0}
		<SelectNodeButton {node} />
	{/if}
{/snippet}

{#if liveNode.node_type === GRADIENT_NODE_TYPE}
	{@render defaultHeader?.(gradientHeaderExtra)}

	{#if !collapsed}
		<div class="node-inspector-content gradient-node-inspector" transition:slide={{ duration: 200 }}>
			<div class="gradient-preview">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="gradient-track"
					bind:this={trackEl}
					style:background-image={gradientCss}
					ondblclick={onTrackDoubleClick}
					title="Double-click to add a stop">
					{#each stops as stop (stop.id)}
						<button
							type="button"
							class="gradient-stop-handle"
							class:selected={stop.id === selected_stop_id}
							style:left={`${(clamp01(stop.position) * 100).toFixed(2)}%`}
							style:--stop-color={cssColor(stop.color)}
							title={`${Math.round(clamp01(stop.position) * 100)}% · ${stop.interpolation} (drag to move, double-click for color, alt-click for interpolation)`}
							aria-label={`Gradient stop at ${Math.round(clamp01(stop.position) * 100)} percent`}
							onpointerdown={(event) => onHandlePointerDown(event, stop)}
							onpointermove={(event) => onHandlePointerMove(event, stop)}
							onpointerup={(event) => onHandlePointerUp(event, stop)}
							ondblclick={(event) => {
								event.stopPropagation();
								openColorEditor(stop);
							}}></button>
					{/each}
				</div>
			</div>

			{#if color_editor_stop_id !== null}
				<div class="gradient-color-editor">
					<div class="gradient-color-editor-header">
						<span>Stop color</span>
						<button type="button" class="gradient-color-editor-close" onclick={() => (color_editor_stop_id = null)}>
							×
						</button>
					</div>
					<ColorPicker bind:color={picker_color} forceExpanded onchange={applyPickerColor} />
				</div>
			{/if}

			<div class="gradient-stop-editor">
				{#if selected_stop_node}
					<NodeInspector nodes={[selected_stop_node]} level={level + 1} order="solo" />
				{:else}
					<div class="empty-state">Double-click the ribbon to add a stop.</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.gradient-node-inspector {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 100%;
		max-width: 100%;
		min-inline-size: 0;
		box-sizing: border-box;
	}

	.gradient-preview {
		/* breathing room so the ribbon does not touch the panel edges and edge stops stay in bounds */
		padding-inline: 0.55rem;
		padding-block: 0.15rem;
		box-sizing: border-box;
	}

	.gradient-track {
		position: relative;
		inline-size: 100%;
		block-size: 2rem;
		border-radius: 0.3rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.18);
		background-color: #000;
		background-size: cover;
		box-sizing: border-box;
		overflow: visible;
		cursor: copy;
	}

	.gradient-stop-handle {
		position: absolute;
		bottom: -0.18rem;
		inline-size: 0.6rem;
		block-size: 0.6rem;
		padding: 0;
		transform: translateX(-50%);
		border-radius: 0.16rem;
		background: var(--stop-color, #fff);
		border: solid 0.07rem rgba(0, 0, 0, 0.65);
		box-shadow: 0 0 0 0.06rem rgba(255, 255, 255, 0.6);
		cursor: grab;
	}

	.gradient-stop-handle:active {
		cursor: grabbing;
	}

	.gradient-stop-handle.selected {
		box-shadow:
			0 0 0 0.07rem rgba(255, 224, 106, 0.95),
			0 0 0.28rem rgba(255, 224, 106, 0.7);
	}

	.gradient-color-editor {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.4rem;
		border-radius: 0.3rem;
		background: rgba(255, 255, 255, 0.04);
		border: solid 0.06rem rgba(255, 255, 255, 0.1);
	}

	.gradient-color-editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.62rem;
		opacity: 0.8;
	}

	.gradient-color-editor-close {
		border: none;
		background: transparent;
		color: inherit;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.gradient-stop-editor {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		overflow: auto;
	}

	.gradient-stop-pill {
		display: inline-flex;
		align-items: center;
		height: 1.02rem;
		padding: 0 0.42rem;
		border-radius: 999rem;
		font-size: 0.6rem;
		background: rgba(119, 196, 255, 0.15);
		border: solid 0.06rem rgba(106, 178, 255, 0.34);
	}

	.empty-state {
		font-size: 0.67rem;
		opacity: 0.68;
		padding: 0.45rem;
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.03);
	}
</style>
