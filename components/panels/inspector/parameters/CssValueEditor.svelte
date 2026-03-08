<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import { CSS_UNIT_OPTIONS } from '$lib/golden_ui/css-value';
	import type { CssUnit, UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let constraints = $derived(param?.constraints);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived(param?.value.kind === 'css_value' ? param.value.value : 0);
	let unit = $derived(param?.value.kind === 'css_value' ? param.value.unit : 'rem');

	let draftValue = $state(0);
	let draftUnit = $state<CssUnit>('rem');

	$effect(() => {
		draftValue = value;
		draftUnit = unit;
	});

	const normalizeValue = (candidate: number): number | null => {
		if (!Number.isFinite(candidate)) {
			return null;
		}
		const policy = constraints?.policy ?? 'ClampAdapt';
		const range = constraints?.range;
		let nextValue = candidate;
		if (range?.kind === 'uniform') {
			const min = range.min;
			const max = range.max;
			if (min !== undefined && max !== undefined && min > max) {
				return null;
			}
			if (min !== undefined && nextValue < min) {
				if (policy === 'ClampAdapt') {
					nextValue = min;
				} else {
					return null;
				}
			}
			if (max !== undefined && nextValue > max) {
				if (policy === 'ClampAdapt') {
					nextValue = max;
				} else {
					return null;
				}
			}
		}
		const step = constraints?.step;
		if (step !== undefined) {
			if (step <= 0) {
				return null;
			}
			const base = constraints?.step_base ?? (constraints?.range?.kind === 'uniform' ? constraints.range.min : undefined) ?? 0;
			const scaled = (nextValue - base) / step;
			const nearest = Math.round(scaled);
			if (policy === 'ClampAdapt') {
				nextValue = base + nearest * step;
			} else if (Math.abs(scaled - nearest) > 1e-9) {
				return null;
			}
		}
		return nextValue;
	};

	const commitValue = async (
		nextValue: number,
		nextUnit: CssUnit
	): Promise<void> => {
		if (!param || param.value.kind !== 'css_value' || readOnly || !enabled) {
			return;
		}
		const normalized = normalizeValue(nextValue);
		if (normalized === null) {
			return;
		}
		draftValue = normalized;
		draftUnit = nextUnit;
		if (normalized === value && nextUnit === unit) {
			return;
		}
		await sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'css_value', value: normalized, unit: nextUnit },
			param.event_behaviour
		);
	};
</script>

<div class="css-value-editor">
	<input
		type="number"
		class="css-value-number"
		step={constraints?.step ?? 0.01}
		value={draftValue}
		disabled={!enabled}
		class:readonly={readOnly}
		onblur={(event) => {
			void commitValue(Number((event.target as HTMLInputElement).value), draftUnit);
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				const target = event.target as HTMLInputElement;
				void commitValue(Number(target.value), draftUnit);
				target.blur();
			}
			if (event.key === 'Escape') {
				draftValue = value;
				(event.target as HTMLInputElement).blur();
			}
		}} />
	<select
		class="css-value-unit"
		value={draftUnit}
		disabled={!enabled || readOnly}
		onchange={(event) => {
			const nextUnit = (event.target as HTMLSelectElement).value as CssUnit;
			void commitValue(draftValue, nextUnit);
		}}>
		{#each CSS_UNIT_OPTIONS as option}
			<option value={option.unit}>{option.label}</option>
		{/each}
	</select>
</div>

<style>
	.css-value-editor {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		height: 1.2rem;
	}

	.css-value-number {
		flex: 1;
		height: 100%;
		box-sizing: border-box;
		font-size: 0.75rem;
	}

	.css-value-unit {
		height: 100%;
		min-inline-size: 4.5rem;
		font-size: 0.75rem;
	}
</style>
