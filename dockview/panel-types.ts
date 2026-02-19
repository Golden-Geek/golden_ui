import type { Component } from "svelte";

export type PanelParams = Record<string, unknown>;
export type PanelDockDirection = "within" | "left" | "right" | "above" | "below";

export interface PanelState {
	panelId: string;
	panelType: string;
	title: string;
	params: PanelParams;
}

export interface PanelApi {
	setTitle: (title: string) => void;
	close: () => void;
}

export interface PanelProps extends PanelState {
	panelApi: PanelApi;
}

export interface PanelExports {
	setPanelState: (next: PanelState) => void;
}

export type PanelComponent = Component<PanelProps, PanelExports>;

export interface PanelDefinition {
	panelType: string;
	title: string;
	component: PanelComponent;
	description?: string;
	defaultParams?: PanelParams;
	origin?: "golden" | "user";
}

export interface UserPanelDefinition {
	title?: string;
	component: PanelComponent;
	description?: string;
	defaultParams?: PanelParams;
}

export type UserPanelDefinitionMap = Record<string, UserPanelDefinition | PanelComponent>;

export interface PanelSpawnPosition {
	referencePanelId?: string;
	direction?: PanelDockDirection;
}

export interface PanelSpawnRequest {
	panelType: string;
	panelId?: string;
	title?: string;
	params?: PanelParams;
	position?: PanelSpawnPosition;
	initialWidth?: number;
	initialHeight?: number;
	minimumWidth?: number;
	maximumWidth?: number;
	minimumHeight?: number;
	maximumHeight?: number;
	inactive?: boolean;
}

// Backward-compatible aliases while callers migrate off Dock-specific naming.
export type DockPanelParams = PanelParams;
export type DockPanelState = PanelState;
export type DockPanelProps = PanelProps;
export type DockPanelExports = PanelExports;
export type DockPanelComponent = PanelComponent;
