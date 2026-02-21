<script lang="ts">
	import type { UiNodeDto, UiNodeMetaDto, UiParamDto } from '$lib/golden_ui/types';
	import EnableButton from '../../common/EnableButton.svelte';
	import { fade } from 'svelte/transition';
	import { propertiesInspectorClass } from './inspector.svelte';

	let { node, level, order } = $props<{
		node: UiNodeDto;
		level: number;
		order: 'first' | 'last' | 'solo' | '';
	}>();

	let param: UiParamDto = $derived(node.data.param);
	let meta: UiNodeMetaDto = $derived(node.meta);
	let type: string = $derived(param.value.kind);
	let canDisable = $derived(node.can_be_disabled ?? false);
	let enabled = $derived(node.enabled ?? true);
	let visible = $derived(meta.tags.includes('hidden') ? false : true);
	let readOnly = $derived(meta.tags.includes('read_only') ?? false);

	let isUserMade = $derived(meta.tags.includes('is_user_made') ?? false); //to find : the right property

	let editorInfos: any = $derived(propertiesInspectorClass[type] ?? null);
	let EditorComponent = $derived(editorInfos ? editorInfos.component : null);
	let useFullSpace = $derived(editorInfos ? (editorInfos.useFullSpace ?? false) : false);

	//Value
	let isValueOverridden = $derived(true);

	let resetValue = (): void => {
		if (readOnly) return;
		//to fill
	};

	//Renaming
	let renamingState = $state({
		isRenaming: false,
		renameDraft: ''
	});

	function commitRename() {
		if (!isUserMade) return;
		const nextName = String(renamingState.renameDraft ?? '').trim();
		if (!nextName) {
			renamingState.isRenaming = false;
			return;
		}

		// node.renameParameter(param.name, nextName);
		renamingState.isRenaming = false;
	}

	// let propertyInfo: any = $derived(
	// 	propertiesInspectorClass[propertyType as keyof typeof propertiesInspectorClass]
	// );

	// let useFullSpace = $derived(propertyInfo ? (propertyInfo.useFullSpace ?? false) : false);

	// let valueOnFocus = undefined as PropertyValueType | undefined;

	// let customPropKey = $derived.by((): string | null => {
	// 	const pk = typeof propKey === 'string' ? propKey : String(propKey ?? '');
	// 	if (!pk) return null;
	// 	if (!pk.startsWith('customProps.')) return null;
	// 	const parts = pk.split('.');
	// 	const last = parts[parts.length - 1];
	// 	return last ? String(last) : null;
	// });
	// let isCustomProperty = $derived(customPropKey != null);

	// let isRenaming = $state(false);
	// let renameDraft = $state('');

	// function checkAndSaveProperty(force: boolean = false) {
	// 	if (property.getRaw() === valueOnFocus && !force) {
	// 		// console.log('No changes detected, skipping save.');
	// 		return;
	// 	}

	// 	saveData('Update ' + definition.name, {
	// 		coalesceID: `${target.id}-parameter-${level}-${definition.name}`
	// 	});
	// }

	// function reconcileTargetsAndSave(label: string, coalesceID: string) {
	// 	for (const t of targets ?? []) {
	// 		if (!t?.applySnapshot || !t?.toSnapshot) continue;
	// 		t.applySnapshot(t.toSnapshot(false), { mode: 'patch' });
	// 	}
	// 	saveData(label, { coalesceID });
	// }

	// async function beginRename() {
	// 	if (!isCustomProperty || definition.readOnly) return;
	// 	renameDraft = definition.name;
	// 	isRenaming = true;
	// 	await tick();
	// }

	// function commitRename() {
	// 	if (!customPropKey) return;
	// 	const nextName = String(renameDraft ?? '').trim();
	// 	if (!nextName) {
	// 		isRenaming = false;
	// 		return;
	// 	}

	// 	for (const t of targets ?? []) {
	// 		if (!t?.addCustomProperty) continue;
	// 		t.addCustomProperty(customPropKey, {
	// 			type: definition.type as PropertyType,
	// 			name: nextName,
	// 			default: definition.default,
	// 			canDisable: definition.canDisable,
	// 			readOnly: definition.readOnly,
	// 			description: definition.description,
	// 			options: definition.options,
	// 			min: typeof definition.min === 'number' ? definition.min : undefined,
	// 			max: typeof definition.max === 'number' ? definition.max : undefined,
	// 			step: typeof definition.step === 'number' ? definition.step : undefined,
	// 			syntax: definition.syntax
	// 		});
	// 	}

	// 	reconcileTargetsAndSave('Rename Custom Property', `custom-prop-rename-${customPropKey}`);
	// 	isRenaming = false;
	// }
</script>

{#if visible}
	<div
		class="parameter-inspector {order} {'level-' + level} {enabled ? '' : 'disabled'}
		{readOnly ? 'readonly' : ''}">
		{#if param}
			<div class="firstline">
				<div class="parameter-label">
					{#if canDisable}
						<EnableButton {node} />
					{/if}
					{#if isUserMade}
						{#if renamingState.isRenaming}
							<input
								class="custom-prop-name"
								autofocus
								bind:value={renamingState.renameDraft}
								onblur={commitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									if (e.key === 'Escape') {
										renamingState.isRenaming = false;
										renamingState.renameDraft = node.meta.label;
									}
								}} />
						{:else}
							<span
								class="custom-prop-name-text"
								role="textbox"
								tabindex="-1"
								ondblclick={() => {
									renamingState.renameDraft = node.meta.label;
									renamingState.isRenaming = true;
								}}
								title="Double-click to rename">
								{node.meta.label}
							</span>
						{/if}
					{:else}
						{node.meta.label}
					{/if}
					{#if !readOnly && isValueOverridden}
						<button
							class="reset-property"
							aria-label="Reset Property"
							onclick={() => {
								resetValue();
							}}
							transition:fade={{ duration: 200 }}>
							⟲
						</button>
					{/if}
				</div>

				{#if EditorComponent}
					<div class="parameter-wrapper {readOnly ? 'readonly' : ''}">
						<EditorComponent {node} />

						<button class="expression-toggle" disabled={readOnly}>ƒ</button>
					</div>
				{/if}
			</div>
		{:else}
			{node.meta.label} has no parameter data.
		{/if}
	</div>
{/if}

<style>
	.parameter-inspector {
		width: 100%;
		display: flex;
		gap: 0.25rem;
		flex-direction: column;
		box-sizing: border-box;
		transition: opacity 0.2s ease;
		padding-left: 0.2rem;
		padding-bottom: 0.2rem;
		overflow: hidden;
	}

	.parameter-inspector:not(.last):not(.solo):not(.level-0) {
		border-bottom: solid 1px rgba(255, 255, 255, 0.05);
	}

	.parameter-inspector .firstline {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
	}

	.parameter-inspector.disabled,
	.parameter-inspector.readonly {
		opacity: 0.5;
		user-select: none;
		touch-action: none;
		pointer-events: none;
	}

	.parameter-wrapper {
		display: flex;
		align-items: center;
		justify-content: right;
		flex-basis: 50%;
	}

	.parameter-wrapper.readonly {
		opacity: 0.6;
		pointer-events: none;
		touch-action: none;
	}

	.parameter-inspector.single {
		padding: 0.1rem 0.3rem 0.2rem 0;
		border-bottom: solid 1px rgb(from var(--border-color) r g b / 5%);
		min-height: 1.5rem;
	}

	.parameter-label {
		display: flex;
		align-items: center;
		min-width: max-content;
	}

	.parameter-label.error {
		color: var(--error-color);
		font-weight: bold;
	}

	.enable-property {
		font-size: 0.5rem;
		padding: 0.2rem 0.2rem 0.1rem;
		vertical-align: middle;
		cursor: pointer;
		pointer-events: all;
	}

	.reset-property {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		margin-left: 0.25rem;
		color: var(--text-color);
		padding: 0;
		opacity: 0.5;
		transition: opacity 0.5s;
	}

	.reset-property:hover {
		opacity: 1;
	}

	.custom-prop-name-text {
		cursor: text;
	}

	.custom-prop-name {
		height: 1.5rem;
		background-color: var(--bg-color);
		color: var(--text-color);
		font-size: 0.8rem;
		border: 1px solid rgba(from var(--border-color) r g b / 20%);
		border-radius: 0.25rem;
		padding: 0 0.35rem;
	}

	.expression-toggle {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		padding: 0 .3rem;
		color: var(--text-color);
		opacity: 0.5;
		transition: opacity 0.1s;
	}

	.expression-toggle:hover {
		opacity: 1;
	}

	.expression-toggle.expression {
		opacity: 0.9;
		color: var(--expression-color);
		font-weight: bold;
	}

	.expression-toggle.binding {
		opacity: 0.9;
		color: var(--binding-color);
		font-weight: bold;
	}
</style>
