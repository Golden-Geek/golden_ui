export type NodeId = number;

export type ParamEventBehaviour = 'Coalesce' | 'Append';
export type ParamConstraintPolicy = 'ClampAdapt' | 'Reject';
export type UiAckStatus = 'applied' | 'staged' | 'rejected';
export type UiLogLevel = 'info' | 'warning' | 'error' | 'success';

export type ParamValue =
	| { kind: 'trigger' }
	| { kind: 'int'; value: number }
	| { kind: 'float'; value: number }
	| { kind: 'str'; value: string }
	| { kind: 'file'; value: string }
	| { kind: 'enum'; value: string }
	| { kind: 'bool'; value: boolean }
	| { kind: 'vec2'; value: [number, number] }
	| { kind: 'vec3'; value: [number, number, number] }
	| { kind: 'color'; value: [number, number, number, number] }
	| {
			kind: 'reference';
			uuid: string;
			cached_id?: NodeId;
			cached_name?: string;
			relative_path_from_root?: string[];
	  };

export type UiReferenceRoot =
	| { kind: 'engineRoot' }
	| { kind: 'uuid'; uuid: string }
	| { kind: 'relativeToOwner'; path: string[] };

export type UiReferenceTargetKind = 'anyNode' | 'parameterOnly';

export type UiFileTypeGroup = 'audio' | 'video' | 'script';

export interface UiFileConstraints {
	allowed_types: UiFileTypeGroup[];
	allowed_extensions: string[];
}

export interface UiReferenceConstraints {
	root: UiReferenceRoot;
	target_kind: UiReferenceTargetKind;
	allowed_node_types: string[];
	allowed_parameter_types: string[];
	custom_filter_key?: string;
	default_search_filter?: string;
}

export type UiScriptRuntimeKind = 'luau' | 'quickJs';

export type UiScriptSource =
	| { kind: 'inline'; text: string }
	| { kind: 'projectFile'; path: string };

export interface UiScriptConfig {
	source: UiScriptSource;
	runtime_hint?: UiScriptRuntimeKind;
	project_root?: string;
}

export interface UiScriptFnSignature {
	args: string[];
	returns?: string;
}

export interface UiScriptExportSpec {
	name: string;
	signature: UiScriptFnSignature;
}

export interface UiScriptManifest {
	api_version: number;
	update_rate_hz?: number;
	exports: UiScriptExportSpec[];
}

export interface UiScriptState {
	config: UiScriptConfig;
	runtime_kind?: UiScriptRuntimeKind;
	effective_update_rate_hz?: number;
	export_names: string[];
	manifest?: UiScriptManifest;
}

export type UiSubscriptionScope =
	| { kind: 'wholeGraph' }
	| { kind: 'subtree'; root: NodeId; max_depth: number };

export type UiUserNodeRole = 'regular' | 'itemRoot';

export interface EventTime {
	tick: number;
	micro: number;
	seq: number;
}

export interface UiNodeWarningDto {
	id?: string;
	message: string;
	detail?: string;
}

export interface UiColorDto {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface UiNodePresentationHintsDto {
	color?: UiColorDto;
	// Warnings that belong to this node.
	warnings?: UiNodeWarningDto[];
	// If > 0, this node also surfaces warnings from descendants up to this depth.
	show_child_warnings_max_depth?: number;
}

export interface UiNodeUserPermissionsDto {
	can_edit_name: boolean;
	can_remove_and_duplicate: boolean;
	can_edit_constraints: boolean;
	can_edit_tags: boolean;
	can_edit_color: boolean;
}

export interface UiNodeMetaDto {
	short_name: string;
	label: string;
	enabled: boolean;
	can_be_disabled: boolean;
	user_permissions: UiNodeUserPermissionsDto;
	description?: string;
	tags: string[];
	presentation?: UiNodePresentationHintsDto;
}

export interface ParamEnumOption {
	variant_id: string;
	value: ParamValue;
	label: string;
	tags: string[];
	ordering?: number;
}

export type UiRangeConstraint =
	| { kind: 'uniform'; min?: number; max?: number }
	| { kind: 'components'; min?: number[]; max?: number[] };

export interface UiParamConstraints {
	range?: UiRangeConstraint;
	step?: number;
	step_base?: number;
	enum_options: ParamEnumOption[];
	policy: ParamConstraintPolicy;
	reference?: UiReferenceConstraints;
	file?: UiFileConstraints;
}

export interface UiParamHints {
	widget?: string;
	unit?: string;
}

export interface UiParamDto {
	value: ParamValue;
	default_value: ParamValue;
	event_behaviour: ParamEventBehaviour;
	read_only: boolean;
	constraints: UiParamConstraints;
	ui_hints: UiParamHints;
	reference_allowed_targets: NodeId[];
	reference_visible_nodes: NodeId[];
}

export interface UiReferenceTargets {
	allowed_target_ids: NodeId[];
	visible_node_ids: NodeId[];
}

export type UiNodeDataDto =
	| { kind: 'parameter'; param: UiParamDto }
	| { kind: 'node'; node_type: string };

export interface UiNodeDto {
	node_id: NodeId;
	uuid: string;
	decl_id: string;
	node_type: string;
	meta: UiNodeMetaDto;
	data: UiNodeDataDto;
	user_role: UiUserNodeRole;
	user_item_kind: string;
	accepted_user_item_kinds: string[];
	creatable_user_items: UiCreatableUserItem[];
	children: NodeId[];
}

export interface UiCreatableUserItem {
	node_type: string;
	item_kind: string;
	label: string;
}

export interface UiSchemaView {
	node_types: Array<{ node_type: string }>;
	enums: Array<{
		enum_id: string;
		variants: Array<{ variant_id: string; label: string; tags: string[]; ordering?: number }>;
	}>;
}

export interface UiHistoryState {
	can_undo: boolean;
	can_redo: boolean;
	undo_len: number;
	redo_len: number;
	active_edit_session: boolean;
}

export interface UiLogRecord {
	id: number;
	timestamp_ms: number;
	level: UiLogLevel;
	tag: string;
	message: string;
	repeat_count?: number;
	origin?: NodeId;
}

export interface UiLoggerState {
	max_entries: number;
	records: UiLogRecord[];
}

export interface UiSnapshot {
	protocol_version: string;
	scope: UiSubscriptionScope;
	at: EventTime;
	nodes: UiNodeDto[];
	schema: UiSchemaView;
	history: UiHistoryState;
	logger: UiLoggerState;
}

export type UiEventKind =
	| { kind: 'paramChanged'; param: NodeId; old_value: ParamValue; new_value: ParamValue }
	| { kind: 'childAdded'; parent: NodeId; child: NodeId; decl_id: string }
	| { kind: 'childRemoved'; parent: NodeId; child: NodeId }
	| { kind: 'childReplaced'; parent: NodeId; old: NodeId; new: NodeId; decl_id: string }
	| { kind: 'childMoved'; child: NodeId; old_parent: NodeId; new_parent: NodeId }
	| { kind: 'childReordered'; parent: NodeId; child: NodeId }
	| { kind: 'nodeCreated'; node: NodeId }
	| { kind: 'nodeDeleted'; node: NodeId }
	| { kind: 'metaChanged'; node: NodeId; patch: Partial<UiNodeMetaDto> }
	| { kind: 'custom'; topic: string; origin?: NodeId; payload: unknown };

export interface UiEventDto {
	time: EventTime;
	kind: UiEventKind;
}

export interface UiEventBatch {
	from?: EventTime;
	to?: EventTime;
	events: UiEventDto[];
}

export type UiEditIntent =
	| { kind: 'beginEdit'; client_edit_id: string; label?: string }
	| { kind: 'endEdit'; client_edit_id: string }
	| { kind: 'setParam'; node: NodeId; value: ParamValue; behaviour: ParamEventBehaviour }
	| { kind: 'moveNode'; node: NodeId; new_parent: NodeId; new_prev_sibling?: NodeId }
	| { kind: 'removeNode'; node: NodeId }
	| { kind: 'createUserItem'; parent: NodeId; node_type: string; label?: string }
	| { kind: 'patchMeta'; node: NodeId; patch: Partial<UiNodeMetaDto> }
	| { kind: 'reevaluateGraph' }
	| { kind: 'clearLogs' }
	| { kind: 'setLogMaxEntries'; max_entries: number }
	| { kind: 'undo' }
	| { kind: 'redo' };

export interface UiAck {
	success: boolean;
	status: UiAckStatus;
	error_code?: string;
	error_message?: string;
	earliest_event_time?: EventTime;
	history?: UiHistoryState;
}

export interface UiClient {
	snapshot(scope?: UiSubscriptionScope): Promise<UiSnapshot>;
	subscribe(
		scope: UiSubscriptionScope,
		from: EventTime | undefined,
		onBatch: (batch: UiEventBatch) => void
	): () => void;
	sendIntent(intent: UiEditIntent): Promise<UiAck>;
	replay(scope: UiSubscriptionScope, from?: EventTime): Promise<UiEventBatch>;
	referenceTargets(paramNodeId: NodeId): Promise<UiReferenceTargets>;
	scriptState(nodeId: NodeId): Promise<UiScriptState>;
	setScriptConfig(nodeId: NodeId, config: UiScriptConfig, forceReload?: boolean): Promise<void>;
	reloadScript(nodeId: NodeId): Promise<void>;
}

export const wholeGraphScope: UiSubscriptionScope = { kind: 'wholeGraph' };
