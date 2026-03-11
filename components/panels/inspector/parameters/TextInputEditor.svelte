<script lang="ts">
	import { appState } from '../../../../store/workbench.svelte';
	import { sendSetParamControlStateIntent, sendSetParamIntent } from '../../../../store/ui-intents';
	import type { UiNodeDto } from '../../../../types';

	let {
		node,
		layoutMode = 'default',
		insideLabel = null
	} = $props<{
		node: UiNodeDto;
		layoutMode?: 'default' | 'widget';
		insideLabel?: string | null;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived.by((): string => {
		if (!param || param.value.kind !== 'str') {
			return '';
		}
		if (param.control.mode === 'templateText' && param.control.spec.mode === 'templateText') {
			return param.control.spec.template;
		}
		return param.value.value;
	});

	let draftValue = $state('');
	let inlineLabel = $derived(typeof insideLabel === 'string' ? insideLabel.trim() : '');
	let showsInlineLabel = $derived(layoutMode === 'widget' && inlineLabel.length > 0);

	$effect(() => {
		draftValue = value;
	});

	const hasWildcardToken = (input: string): boolean => {
		const chars = [...input];
		let index = 0;
		while (index < chars.length) {
			if (chars[index] !== '{') {
				index += 1;
				continue;
			}

			// Escaped literal "{{"
			if (index + 1 < chars.length && chars[index + 1] === '{') {
				index += 2;
				continue;
			}

			let end = index + 1;
			while (end < chars.length && chars[end] !== '}') {
				end += 1;
			}
			if (end >= chars.length) {
				break;
			}

			const token = chars
				.slice(index + 1, end)
				.join('')
				.trim();
			if (token.length > 0) {
				return true;
			}
			index = end + 1;
		}
		return false;
	};

	const commitValue = async (nextValue: string): Promise<void> => {
		if (!param || param.value.kind !== 'str' || readOnly || !enabled) {
			return;
		}
		const shouldUseTemplateMode = hasWildcardToken(nextValue);
		const isTemplateMode = param.control.mode === 'templateText';
		const isManualMode = param.control.mode === 'manual';
		const modeNeedsUpdate =
			(shouldUseTemplateMode && !isTemplateMode) ||
			(!shouldUseTemplateMode && !isManualMode) ||
			(shouldUseTemplateMode &&
				param.control.spec.mode === 'templateText' &&
				param.control.spec.template !== nextValue);

		if (!modeNeedsUpdate && nextValue === value) {
			return;
		}

		draftValue = nextValue;

		if (shouldUseTemplateMode) {
			const applied = await sendSetParamControlStateIntent(liveNode.node_id, {
				mode: 'templateText',
				spec: { mode: 'templateText', template: nextValue }
			});
			if (applied) {
				return;
			}
		}

		if (!isManualMode) {
			await sendSetParamControlStateIntent(liveNode.node_id, {
				mode: 'manual',
				spec: { mode: 'manual' }
			});
		}

		if (nextValue !== (param.value.kind === 'str' ? param.value.value : '')) {
			await sendSetParamIntent(
				liveNode.node_id,
				{ kind: 'str', value: nextValue },
				param.event_behaviour
			);
		}
	};
</script>

{#if showsInlineLabel}
	<div class="string-editor-shell widget-layout">
		<span class="string-editor-prefix">{inlineLabel} :</span>
		<input
			type="text"
			class="string-editor inline-labeled"
			value={draftValue}
			disabled={!enabled}
			class:readonly={readOnly}
			onchange={(event) => {
				const nextValue = (event.target as HTMLInputElement).value;
				void commitValue(nextValue);
			}}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					const target = event.target as HTMLInputElement;
					void commitValue(target.value);
					target.blur();
				}
				if (event.key === 'Escape') {
					draftValue = value;
					(event.target as HTMLInputElement).blur();
				}
			}} />
	</div>
{:else}
	<input
		type="text"
		class="string-editor"
		class:widget-layout={layoutMode === 'widget'}
		value={draftValue}
		disabled={!enabled}
		class:readonly={readOnly}
		onchange={(event) => {
			const nextValue = (event.target as HTMLInputElement).value;
			void commitValue(nextValue);
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				const target = event.target as HTMLInputElement;
				void commitValue(target.value);
				target.blur();
			}
			if (event.key === 'Escape') {
				draftValue = value;
				(event.target as HTMLInputElement).blur();
			}
		}} />
{/if}

<style>
	.string-editor-shell {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 0.75rem;
		background: rgb(from var(--gc-color-background) r g b / 0.48);
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.48);
		box-sizing: border-box;
	}

	.string-editor-prefix {
		flex: 0 0 auto;
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.string-editor {
		flex: 1;
		height: 100%;
		box-sizing: border-box;
		font-size: 0.75rem;
	}

	.string-editor.widget-layout {
		inline-size: 100%;
		block-size: 100%;
	}

	.string-editor.inline-labeled {
		border: none;
		background: transparent;
		padding: 0;
		min-inline-size: 0;
		outline: none;
	}
</style>
