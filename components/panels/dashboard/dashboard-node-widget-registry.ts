import type { UiNodeDto } from '$lib/golden_ui/types';
import DashboardNodeWidgetInspectorContent from './DashboardNodeWidgetInspectorContent.svelte';
import DashboardNodeWidgetParameterEditorContent from './DashboardNodeWidgetParameterEditorContent.svelte';

export interface DashboardNodeWidgetDisplayModeEntry {
	id: string;
	label: string;
	component: any;
	supportsTarget?: (targetNode: UiNodeDto) => boolean;
	isDefaultForTarget?: (targetNode: UiNodeDto) => boolean;
}

export interface DashboardNodeWidgetDisplayModeRegistration {
	defaultModeId?: string;
	modes: DashboardNodeWidgetDisplayModeEntry[];
}

const builtinDisplayModes: DashboardNodeWidgetDisplayModeEntry[] = [
	{
		id: 'inspector',
		label: 'Inspector',
		component: DashboardNodeWidgetInspectorContent,
		supportsTarget: () => true,
		isDefaultForTarget: (targetNode) => targetNode.data.kind !== 'parameter'
	},
	{
		id: 'editor',
		label: 'Editor',
		component: DashboardNodeWidgetParameterEditorContent,
		supportsTarget: (targetNode) => targetNode.data.kind === 'parameter',
		isDefaultForTarget: (targetNode) => targetNode.data.kind === 'parameter'
	}
];

const customDisplayModeRegistrations = new Map<string, DashboardNodeWidgetDisplayModeRegistration>();

const normalizeNodeType = (nodeType: string): string => nodeType.trim();

const getSupportedModes = (targetNode: UiNodeDto): DashboardNodeWidgetDisplayModeEntry[] => {
	const registration = customDisplayModeRegistrations.get(normalizeNodeType(targetNode.node_type));
	const customModes = registration?.modes ?? [];
	return [...customModes, ...builtinDisplayModes].filter(
		(mode) => mode.supportsTarget?.(targetNode) ?? true
	);
};

const getDefaultModeId = (targetNode: UiNodeDto, supportedModes: DashboardNodeWidgetDisplayModeEntry[]): string | null => {
	const registration = customDisplayModeRegistrations.get(normalizeNodeType(targetNode.node_type));
	if (registration?.defaultModeId && supportedModes.some((mode) => mode.id === registration.defaultModeId)) {
		return registration.defaultModeId;
	}
	return supportedModes.find((mode) => mode.isDefaultForTarget?.(targetNode))?.id ?? supportedModes[0]?.id ?? null;
};

export const registerDashboardNodeWidgetDisplayModes = (
	nodeType: string,
	registration: DashboardNodeWidgetDisplayModeRegistration
): void => {
	const normalizedNodeType = normalizeNodeType(nodeType);
	if (!normalizedNodeType) {
		throw new Error('Dashboard node widget display mode registration requires a non-empty node type.');
	}
	customDisplayModeRegistrations.set(normalizedNodeType, registration);
};

export const unregisterDashboardNodeWidgetDisplayModes = (nodeType: string): void => {
	customDisplayModeRegistrations.delete(normalizeNodeType(nodeType));
};

export const clearDashboardNodeWidgetDisplayModes = (): void => {
	customDisplayModeRegistrations.clear();
};

export const resolveDashboardNodeWidgetDisplayMode = (
	targetNode: UiNodeDto,
	requestedModeId: string
): DashboardNodeWidgetDisplayModeEntry | null => {
	const supportedModes = getSupportedModes(targetNode);
	if (supportedModes.length === 0) {
		return null;
	}
	const normalizedRequestedModeId = requestedModeId.trim();
	if (normalizedRequestedModeId.length > 0 && normalizedRequestedModeId !== 'auto') {
		const requestedMode = supportedModes.find((mode) => mode.id === normalizedRequestedModeId);
		if (requestedMode) {
			return requestedMode;
		}
	}
	const defaultModeId = getDefaultModeId(targetNode, supportedModes);
	return supportedModes.find((mode) => mode.id === defaultModeId) ?? supportedModes[0];
};