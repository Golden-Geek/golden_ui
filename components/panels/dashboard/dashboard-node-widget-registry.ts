import type { UiNodeDto } from '$lib/golden_ui/types';
import DashboardNodeWidgetInspectorContent from './DashboardNodeWidgetInspectorContent.svelte';
import DashboardNodeWidgetParameterEditorContent from './DashboardNodeWidgetParameterEditorContent.svelte';
import DashboardNodeWidgetVec2PadContent from './DashboardNodeWidgetVec2PadContent.svelte';

export interface DashboardNodeWidgetDisplayModeEntry {
	id: string;
	component: any;
	usesLabelPlacement: boolean;
	isCompatible?: (targetNode: UiNodeDto) => boolean;
}

const builtinDisplayModes = new Map<string, DashboardNodeWidgetDisplayModeEntry>([
	[
		'inspector',
		{
			id: 'inspector',
			component: DashboardNodeWidgetInspectorContent,
			usesLabelPlacement: false,
			isCompatible: () => true
		}
	],
	[
		'editor',
		{
			id: 'editor',
			component: DashboardNodeWidgetParameterEditorContent,
			usesLabelPlacement: true,
			isCompatible: (targetNode) => targetNode.data.kind === 'parameter'
		}
	],
	[
		'vec2Pad',
		{
			id: 'vec2Pad',
			component: DashboardNodeWidgetVec2PadContent,
			usesLabelPlacement: true,
			isCompatible: (targetNode) =>
				targetNode.data.kind === 'parameter' && targetNode.data.param.value.kind === 'vec2'
		}
	]
]);

const customDisplayModes = new Map<string, DashboardNodeWidgetDisplayModeEntry>();

const getDisplayModeEntry = (modeId: string): DashboardNodeWidgetDisplayModeEntry | null =>
	customDisplayModes.get(modeId) ?? builtinDisplayModes.get(modeId) ?? null;

export const registerDashboardNodeWidgetDisplayMode = (
	entry: DashboardNodeWidgetDisplayModeEntry
): void => {
	const modeId = entry.id.trim();
	if (modeId.length === 0) {
		throw new Error('Dashboard node widget display mode registration requires a non-empty id.');
	}
	customDisplayModes.set(modeId, {
		...entry,
		id: modeId
	});
};

export const unregisterDashboardNodeWidgetDisplayMode = (modeId: string): void => {
	customDisplayModes.delete(modeId.trim());
};

export const clearDashboardNodeWidgetDisplayModes = (): void => {
	customDisplayModes.clear();
};

export const resolveDashboardNodeWidgetDisplayMode = (
	targetNode: UiNodeDto,
	requestedModeId: string
): DashboardNodeWidgetDisplayModeEntry | null => {
	const normalizedRequestedModeId = requestedModeId.trim();
	const requestedMode = normalizedRequestedModeId.length > 0
		? getDisplayModeEntry(normalizedRequestedModeId)
		: null;
	if (requestedMode && (requestedMode.isCompatible?.(targetNode) ?? true)) {
		return requestedMode;
	}

	const inspectorMode = getDisplayModeEntry('inspector');
	if (inspectorMode && (inspectorMode.isCompatible?.(targetNode) ?? true)) {
		return inspectorMode;
	}

	for (const mode of [...customDisplayModes.values(), ...builtinDisplayModes.values()]) {
		if (mode.isCompatible?.(targetNode) ?? true) {
			return mode;
		}
	}

	return null;
};
