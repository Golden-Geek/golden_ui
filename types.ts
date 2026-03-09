export type NodeId = number;

export type ParamEventBehaviour = 'Coalesce' | 'Append';
export type ParamConstraintPolicy = 'ClampAdapt' | 'Reject';
export type UiAckStatus = 'applied' | 'staged' | 'rejected';
export type UiLogLevel = 'info' | 'warning' | 'error' | 'success';
export type UiParameterControlMode =
	| 'manual'
	| 'contextLink'
	| 'templateText'
	| 'expression'
	| 'proxy'
	| 'binding'
	| 'animation';

export type CssUnit = 'px' | 'rem' | 'em' | 'percent' | 'vw' | 'vh';

export type ParamValue =
	| { kind: 'trigger' }
	| { kind: 'int'; value: number }
	| { kind: 'float'; value: number }
	| { kind: 'str'; value: string }
	| { kind: 'file'; value: string }
	| { kind: 'enum'; value: string }
	| { kind: 'bool'; value: boolean }
	| { kind: 'css_value'; value: number; unit: CssUnit }
	| { kind: 'vec2'; value: [number, number] }
	| { kind: 'vec3'; value: [number, number, number] }
	| { kind: 'color'; value: [number, number, number, number] }
	| {
			kind: 'reference';
			uuid: string;
			projection?: UiParamValueProjection;
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
	allow_projections: boolean;
	custom_filter_key?: string;
	default_search_filter?: string;
}

export type UiScriptSource =
	| { kind: 'inline'; text: string }
	| { kind: 'projectFile'; path: string };

export interface UiScriptConfig {
	source: UiScriptSource;
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
	declared_description_key?: string;
	description_overridden?: boolean;
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

export type UiUserContextValueType =
	| 'trigger'
	| 'int'
	| 'float'
	| 'str'
	| 'file'
	| 'enum'
	| 'bool'
	| 'css_value'
	| 'vec2'
	| 'vec3'
	| 'color'
	| 'reference';

export type UiParamValueProjection =
	| 'floatToVec2X0'
	| 'floatToVec20Y'
	| 'floatToVec2XX'
	| 'floatToVec3X00'
	| 'floatToVec30Y0'
	| 'floatToVec300Z'
	| 'floatToVec3XXX'
	| 'vec2X'
	| 'vec2Y'
	| 'vec2ToVec3XY0'
	| 'vec2ToVec3X0Y'
	| 'vec2ToColorHs'
	| 'vec3X'
	| 'vec3Y'
	| 'vec3Z'
	| 'vec3ToVec2XY'
	| 'vec3ToVec2XZ'
	| 'vec3ToVec2YZ'
	| 'vec3ToColorRgb'
	| 'vec3ToColorHsv'
	| 'colorR'
	| 'colorG'
	| 'colorB'
	| 'colorA'
	| 'colorToVec3Rgb'
	| 'colorToVec3Hsv'
	| 'colorToVec2Hs';

export interface UiUserContextCandidate {
	symbol: string;
	value_type: UiUserContextValueType;
	scope_owner: NodeId;
	lexical_depth: number;
	entry_param: NodeId;
	compatible: boolean;
	shadowed: boolean;
	projections: UiParamValueProjection[];
}

export interface UiTokenSuggestion {
	token: string;
}

export interface UiParamControlCandidate {
	param: NodeId;
	compatible: boolean;
	projections: UiParamValueProjection[];
}

export interface UiParamControlInfo {
	param: NodeId;
	active_mode: UiParameterControlMode;
	available_modes: UiParameterControlMode[];
	context_candidates: UiUserContextCandidate[];
	token_suggestions: UiTokenSuggestion[];
	proxy_candidates: UiParamControlCandidate[];
	binding_candidates: UiParamControlCandidate[];
}

export interface UiNodeReferenceValue {
	uuid: string;
	projection?: UiParamValueProjection;
	cached_id?: NodeId;
	cached_name?: string;
	relative_path_from_root?: string[];
}

export interface UiAnimationControlSpec {
	waveform: 'sine' | 'triangle' | 'saw' | 'square';
	frequency_hz: number;
	amplitude: number;
	offset: number;
	phase: number;
}

export type UiParameterControlSpec =
	| { mode: 'manual' }
	| { mode: 'contextLink'; symbol: string; projection?: UiParamValueProjection }
	| { mode: 'templateText'; template: string }
	| { mode: 'expression' }
	| { mode: 'proxy' }
	| { mode: 'binding' }
	| { mode: 'animation' };

export interface UiParameterControlState {
	mode: UiParameterControlMode;
	spec: UiParameterControlSpec;
}

export interface UiParamDto {
	value: ParamValue;
	default_value: ParamValue;
	event_behaviour: ParamEventBehaviour;
	read_only: boolean;
	constraints: UiParamConstraints;
	ui_hints: UiParamHints;
	control: UiParameterControlState;
	reference_allowed_targets: NodeId[];
	reference_visible_nodes: NodeId[];
}

export interface UiReferenceTargets {
	allowed_target_ids: NodeId[];
	visible_node_ids: NodeId[];
	candidates: UiReferenceTargetCandidate[];
}

export interface UiReferenceTargetCandidate {
	target_id: NodeId;
	direct: boolean;
	projections: UiParamValueProjection[];
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

export interface UiNodeTypeDescriptor {
	node_type: string;
	description?: string;
}

export interface UiDeclaredDescriptionDescriptor {
	key: string;
	description: string;
}

export interface UiSchemaView {
	node_types: UiNodeTypeDescriptor[];
	declared_descriptions: UiDeclaredDescriptionDescriptor[];
	enums: Array<{
		enum_id: string;
		variants: Array<{
			variant_id: string;
			value: ParamValue;
			label: string;
			tags: string[];
			ordering?: number;
		}>;
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
	| {
			kind: 'paramControlChanged';
			param: NodeId;
			old_state: UiParameterControlState;
			new_state: UiParameterControlState;
	  }
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

export interface UiAnimationCurveFitPoint {
	position: number;
	value: number;
}

export interface UiAnimationCurveBezierFitOptions {
	max_value_error: number;
	max_keys: number;
}

export interface UiCreateUserItemInitialParam {
	decl_id: string;
	value: ParamValue;
}

export type UiEditIntent =
	| { kind: 'beginEdit'; client_edit_id: string; label?: string }
	| { kind: 'endEdit'; client_edit_id: string }
	| { kind: 'setParam'; node: NodeId; value: ParamValue; behaviour: ParamEventBehaviour }
	| { kind: 'setParamControlState'; node: NodeId; state: UiParameterControlState }
	| { kind: 'moveNode'; node: NodeId; new_parent: NodeId; new_prev_sibling?: NodeId }
	| { kind: 'removeNode'; node: NodeId }
	| { kind: 'removeNodes'; nodes: NodeId[] }
	| {
			kind: 'createUserItem';
			parent: NodeId;
			node_type: string;
			label?: string;
			initial_params?: UiCreateUserItemInitialParam[];
	  }
	| {
			kind: 'duplicateNode';
			source: NodeId;
			new_parent: NodeId;
			new_prev_sibling?: NodeId;
			label?: string;
	  }
	| {
			kind: 'fitAnimationCurvePath';
			curve: NodeId;
			points: UiAnimationCurveFitPoint[];
			options: UiAnimationCurveBezierFitOptions;
	  }
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
	sendIntents(intents: UiEditIntent[]): Promise<UiAck[]>;
	replay(scope: UiSubscriptionScope, from?: EventTime): Promise<UiEventBatch>;
	referenceTargets(paramNodeId: NodeId): Promise<UiReferenceTargets>;
	paramControlInfo(paramNodeId: NodeId): Promise<UiParamControlInfo>;
	scriptState(nodeId: NodeId): Promise<UiScriptState>;
	setScriptConfig(nodeId: NodeId, config: UiScriptConfig, forceReload?: boolean): Promise<void>;
	reloadScript(nodeId: NodeId): Promise<void>;
	projectSave(path: string): Promise<void>;
	projectLoad(path: string): Promise<void>;
}

export const wholeGraphScope: UiSubscriptionScope = { kind: 'wholeGraph' };
