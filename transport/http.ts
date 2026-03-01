import type {
	EventTime,
	ParamConstraintPolicy,
	ParamEventBehaviour,
	ParamValue,
	UiAck,
	UiClient,
	UiEditIntent,
	UiEventBatch,
	UiEventDto,
	UiLogRecord,
	UiNodeDataDto,
	UiNodeDto,
	UiHistoryState,
	UiNodeMetaDto,
	UiParamConstraints,
	UiParamDto,
	UiFileConstraints,
	UiReferenceConstraints,
	UiReferenceTargets,
	UiReferenceRoot,
	UiScriptConfig,
	UiScriptManifest,
	UiScriptSource,
	UiScriptState,
	UiSnapshot,
	UiSubscriptionScope
} from '../types';
import { wholeGraphScope } from '../types';

const DEFAULT_BASE_URL = 'http://localhost:7010/api/ui';
const DEFAULT_POLL_INTERVAL_MS = 150;

interface HttpClientOptions {
	baseUrl?: string;
	pollIntervalMs?: number;
	fetchImpl?: typeof fetch;
}

export type RustScope = string | { subtree: { root: number; max_depth: number } };

export interface RustSnapshotRequest {
	scope: RustScope;
}

export interface RustReplayRequest {
	scope: RustScope;
	from?: EventTime;
}

export interface RustReferenceTargetsRequest {
	param: number;
}

export interface RustReferenceTargetsResponse {
	allowed_targets?: number[];
	visible_nodes?: number[];
}

export interface RustScriptStateRequest {
	node: number;
}

export interface RustScriptConfigRequest {
	node: number;
	config: RustScriptConfig;
	force_reload?: boolean;
}

export interface RustScriptReloadRequest {
	node: number;
}

export type RustParamValue =
	| string
	| {
			[key: string]: unknown;
	  };

type RustScriptSource =
	| { kind: 'inline'; text: string }
	| { kind: 'projectFile'; path: string };

interface RustScriptConfig {
	source: RustScriptSource;
}

interface RustScriptManifest {
	api_version?: number;
	update_rate_hz?: number;
	exports?: Array<{
		name?: string;
		signature?: {
			args?: string[];
			returns?: string;
		};
	}>;
}

interface RustScriptState {
	config: RustScriptConfig;
	effective_update_rate_hz?: number;
	export_names?: string[];
	manifest?: RustScriptManifest;
}

interface RustUiParamDto {
	value: RustParamValue;
	default_value?: RustParamValue;
	event_behaviour: ParamEventBehaviour;
	read_only: boolean;
	constraints: {
		range?: {
			kind?: string;
			min?: number | number[];
			max?: number | number[];
		};
		step?: number;
		step_base?: number;
		enum_options?: Array<{
			variant_id: string;
			value: RustParamValue;
			label: string;
			tags?: string[];
			ordering?: number;
		}>;
		policy: ParamConstraintPolicy;
		reference?: {
			root?: unknown;
			target_kind?: string;
			allowed_node_types?: string[];
			allowed_parameter_types?: string[];
			custom_filter_key?: string;
			default_search_filter?: string;
		};
		file?: {
			allowed_types?: string[];
			allowed_extensions?: string[];
		};
	};
	reference_allowed_targets?: number[];
	reference_visible_nodes?: number[];
	ui_hints?: {
		widget?: string;
		unit?: string;
	};
}

interface RustUiLogRecord extends UiLogRecord {}

interface RustUiLoggerState {
	max_entries: number;
	records?: RustUiLogRecord[];
}

interface RustUiNodeDto {
	node_id: number;
	uuid: string;
	decl_id: string;
	node_type: string;
	meta: Omit<UiNodeMetaDto, 'tags' | 'user_permissions'> & {
		tags?: string[];
		user_permissions?: Partial<UiNodeMetaDto['user_permissions']>;
	};
	data: { kind: 'parameter'; param: RustUiParamDto } | { kind: 'node'; node_type: string };
	user_role?: 'regular' | 'itemRoot';
	user_item_kind?: string;
	accepted_user_item_kinds?: string[];
	creatable_user_items?: Array<{ node_type: string; item_kind: string; label: string }>;
	children: number[];
}

export interface RustUiSnapshot {
	protocol_version: string;
	scope: RustScope;
	at: EventTime;
	nodes: RustUiNodeDto[];
	schema: Partial<UiSnapshot['schema']>;
	history?: UiHistoryState;
	logger?: RustUiLoggerState;
}

type RustUiEventDto =
	| (Omit<UiEventDto, 'kind'> & {
			kind:
				| {
						kind: 'paramChanged';
						param: number;
						old_value: RustParamValue;
						new_value: RustParamValue;
				  }
				| Exclude<UiEventDto['kind'], { kind: 'paramChanged' }>;
	  })
	| (Omit<UiEventDto, 'kind'> & {
			kind: UiEventDto['kind']['kind'];
			param?: number;
			old_value?: RustParamValue;
			new_value?: RustParamValue;
			parent?: number;
			child?: number;
			decl_id?: string;
			old?: number;
			new?: number;
			old_parent?: number;
			new_parent?: number;
			node?: number;
			patch?: unknown;
			topic?: string;
			origin?: number;
			payload?: unknown;
	  });

export interface RustUiEventBatch {
	from?: EventTime;
	to?: EventTime;
	events: RustUiEventDto[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const toRustScope = (scope: UiSubscriptionScope): RustScope => {
	if (scope.kind === 'wholeGraph') {
		return 'wholeGraph';
	}
	return { subtree: { root: scope.root, max_depth: scope.max_depth } };
};

export const fromRustScope = (scope: unknown): UiSubscriptionScope => {
	if (scope === 'wholeGraph' || scope === 'WholeGraph') {
		return { kind: 'wholeGraph' };
	}

	if (isRecord(scope)) {
		if (scope.kind === 'wholeGraph') {
			return { kind: 'wholeGraph' };
		}
		if (scope.kind === 'subtree') {
			const root = Number(scope.root ?? 0);
			const maxDepth = Number(scope.max_depth ?? 0);
			return { kind: 'subtree', root, max_depth: maxDepth };
		}

		const subtree = scope.subtree;
		if (isRecord(subtree)) {
			return {
				kind: 'subtree',
				root: Number(subtree.root ?? 0),
				max_depth: Number(subtree.max_depth ?? 0)
			};
		}
	}

	return { kind: 'wholeGraph' };
};

const fromRustReferencePayload = (
	payload: unknown
): { uuid: string; cached_id?: number; cached_name?: string; relative_path_from_root?: string[] } => {
	if (typeof payload === 'string') {
		return { uuid: payload };
	}

	if (isRecord(payload)) {
		const rawUuid = payload.uuid;
		const uuid =
			typeof rawUuid === 'string'
				? rawUuid
				: isRecord(rawUuid) && typeof rawUuid['0'] === 'string'
					? String(rawUuid['0'])
					: '';

		const cached = payload.cached_id;
		const cached_id = typeof cached === 'number' ? cached : undefined;
		const cachedName = payload.cached_name;
		const cached_name = typeof cachedName === 'string' ? cachedName : undefined;
		const relativePathRaw = payload.relative_path_from_root;
		const relative_path_from_root = Array.isArray(relativePathRaw)
			? relativePathRaw.filter((segment): segment is string => typeof segment === 'string')
			: undefined;
		return { uuid, cached_id, cached_name, relative_path_from_root };
	}

	return { uuid: '' };
};

const fromRustParamValue = (value: unknown): ParamValue => {
	if (typeof value === 'string') {
		if (value === 'Trigger' || value === 'trigger') {
			return { kind: 'trigger' };
		}
		if (value === 'BoolTrue') {
			return { kind: 'bool', value: true };
		}
		if (value === 'BoolFalse') {
			return { kind: 'bool', value: false };
		}
		return { kind: 'str', value };
	}

	if (!isRecord(value)) {
		return { kind: 'str', value: String(value) };
	}

	if ('Int' in value) {
		return { kind: 'int', value: Number(value.Int ?? 0) };
	}
	if ('Float' in value) {
		return { kind: 'float', value: Number(value.Float ?? 0) };
	}
	if ('Str' in value) {
		return { kind: 'str', value: String(value.Str ?? '') };
	}
	if ('File' in value) {
		return { kind: 'file', value: String(value.File ?? '') };
	}
	if ('Enum' in value) {
		return { kind: 'enum', value: String(value.Enum ?? '') };
	}
	if ('Bool' in value) {
		return { kind: 'bool', value: Boolean(value.Bool) };
	}
	if ('Vec2' in value && Array.isArray(value.Vec2)) {
		const vec = value.Vec2 as unknown[];
		return { kind: 'vec2', value: [Number(vec[0] ?? 0), Number(vec[1] ?? 0)] };
	}
	if ('Vec3' in value && Array.isArray(value.Vec3)) {
		const vec = value.Vec3 as unknown[];
		return {
			kind: 'vec3',
			value: [Number(vec[0] ?? 0), Number(vec[1] ?? 0), Number(vec[2] ?? 0)]
		};
	}
	if ('Color' in value && Array.isArray(value.Color)) {
		const vec = value.Color as unknown[];
		return {
			kind: 'color',
			value: [
				Number(vec[0] ?? 0),
				Number(vec[1] ?? 0),
				Number(vec[2] ?? 0),
				Number(vec[3] ?? 1)
			]
		};
	}
	if ('Reference' in value) {
		const reference = fromRustReferencePayload(value.Reference);
		return {
			kind: 'reference',
			uuid: reference.uuid,
			cached_id: reference.cached_id,
			cached_name: reference.cached_name,
			relative_path_from_root: reference.relative_path_from_root
		};
	}
	if ('Trigger' in value) {
		return { kind: 'trigger' };
	}

	return { kind: 'str', value: JSON.stringify(value) };
};

const toRustParamValue = (value: ParamValue): RustParamValue => {
	switch (value.kind) {
		case 'trigger':
			return { Trigger: [] };
		case 'int':
			return { Int: value.value };
		case 'float':
			return { Float: value.value };
		case 'str':
			return { Str: value.value };
		case 'file':
			return { File: value.value };
		case 'enum':
			return { Enum: value.value };
		case 'bool':
			return { Bool: value.value };
		case 'vec2':
			return { Vec2: value.value };
		case 'vec3':
			return { Vec3: value.value };
		case 'color':
			return { Color: value.value };
		case 'reference':
			return {
				Reference: {
					uuid: value.uuid,
					cached_name: value.cached_name,
					relative_path_from_root: value.relative_path_from_root ?? []
				}
			};
	}
};

const fromRustReferenceRoot = (root: unknown): UiReferenceRoot => {
	if (typeof root === 'string') {
		if (root === 'EngineRoot' || root === 'engineRoot') {
			return { kind: 'engineRoot' };
		}
	}

	if (isRecord(root)) {
		if ('Uuid' in root) {
			const uuid = root.Uuid;
			return { kind: 'uuid', uuid: typeof uuid === 'string' ? uuid : '' };
		}
		if ('RelativeToOwner' in root) {
			const payload = root.RelativeToOwner;
			const path = isRecord(payload) && Array.isArray(payload.path) ? payload.path.filter((segment): segment is string => typeof segment === 'string') : [];
			return { kind: 'relativeToOwner', path };
		}
		if (root.kind === 'uuid') {
			return { kind: 'uuid', uuid: String(root.uuid ?? '') };
		}
		if (root.kind === 'relativeToOwner') {
			const rawPath = root.path;
			const path = Array.isArray(rawPath) ? rawPath.filter((segment): segment is string => typeof segment === 'string') : [];
			return { kind: 'relativeToOwner', path };
		}
	}

	return { kind: 'engineRoot' };
};

const fromRustReferenceConstraints = (reference: RustUiParamDto['constraints']['reference']): UiReferenceConstraints | undefined => {
	if (!reference) {
		return undefined;
	}

	const target_kind =
		reference.target_kind === 'ParameterOnly' || reference.target_kind === 'parameterOnly'
			? 'parameterOnly'
			: 'anyNode';

	return {
		root: fromRustReferenceRoot(reference.root),
		target_kind,
		allowed_node_types: [...(reference.allowed_node_types ?? [])],
		allowed_parameter_types: [...(reference.allowed_parameter_types ?? [])],
		custom_filter_key:
			typeof reference.custom_filter_key === 'string' ? reference.custom_filter_key : undefined,
		default_search_filter:
			typeof reference.default_search_filter === 'string'
				? reference.default_search_filter
				: undefined
	};
};

const fromRustFileConstraints = (file: RustUiParamDto['constraints']['file']): UiFileConstraints | undefined => {
	if (!file) {
		return undefined;
	}

	const allowed_types = (file.allowed_types ?? [])
		.map((value) => String(value).toLowerCase())
		.filter((value): value is UiFileConstraints['allowed_types'][number] => value === 'audio' || value === 'video' || value === 'script');
	const allowed_extensions = (file.allowed_extensions ?? [])
		.map((value) => String(value).trim())
		.filter((value) => value.length > 0);

	return {
		allowed_types,
		allowed_extensions
	};
};

const fromRustScriptSource = (source: unknown): UiScriptSource => {
	if (isRecord(source)) {
		if (source.kind === 'projectFile') {
			return { kind: 'projectFile', path: String(source.path ?? '') };
		}
		if (source.kind === 'inline') {
			return { kind: 'inline', text: String(source.text ?? '') };
		}
	}
	return { kind: 'inline', text: '' };
};

const toRustScriptSource = (source: UiScriptSource): RustScriptSource => {
	if (source.kind === 'projectFile') {
		return { kind: 'projectFile', path: source.path };
	}
	return { kind: 'inline', text: source.text };
};

const fromRustScriptConfig = (config: unknown): UiScriptConfig => {
	if (!isRecord(config)) {
		return {
			source: { kind: 'inline', text: '' }
		};
	}

	return {
		source: fromRustScriptSource(config.source)
	};
};

const toRustScriptConfig = (config: UiScriptConfig): RustScriptConfig => ({
	source: toRustScriptSource(config.source)
});

const fromRustScriptManifest = (manifest: unknown): UiScriptManifest | undefined => {
	if (!isRecord(manifest)) {
		return undefined;
	}

	const apiVersion =
		typeof manifest.api_version === 'number' && Number.isFinite(manifest.api_version)
			? Math.max(1, Math.round(manifest.api_version))
			: undefined;
	if (apiVersion === undefined) {
		return undefined;
	}

	const exports = Array.isArray(manifest.exports)
		? manifest.exports
				.filter((value): value is Record<string, unknown> => isRecord(value))
				.map((value) => {
					const signature = isRecord(value.signature) ? value.signature : {};
					const argsRaw = signature.args;
					const args = Array.isArray(argsRaw)
						? argsRaw.filter((entry): entry is string => typeof entry === 'string')
						: [];
					const returns =
						typeof signature.returns === 'string' && signature.returns.length > 0
							? signature.returns
							: undefined;
					return {
						name: String(value.name ?? ''),
						signature: { args, returns }
					};
				})
				.filter((value) => value.name.length > 0)
		: [];

	return {
		api_version: apiVersion,
		update_rate_hz:
			typeof manifest.update_rate_hz === 'number' &&
			Number.isFinite(manifest.update_rate_hz)
				? Math.max(1, Math.round(manifest.update_rate_hz))
				: undefined,
		exports
	};
};

const fromRustScriptState = (state: RustScriptState): UiScriptState => ({
	config: fromRustScriptConfig(state.config),
	effective_update_rate_hz:
		typeof state.effective_update_rate_hz === 'number' &&
		Number.isFinite(state.effective_update_rate_hz)
			? Math.max(1, Math.round(state.effective_update_rate_hz))
			: undefined,
	export_names: Array.isArray(state.export_names)
		? state.export_names.filter((name): name is string => typeof name === 'string')
		: [],
	manifest: fromRustScriptManifest(state.manifest)
});

const fromRustRangeConstraint = (
	range: RustUiParamDto['constraints']['range']
): UiParamConstraints['range'] | undefined => {
	if (!range || typeof range !== 'object') {
		return undefined;
	}

	const kind = String(range.kind ?? '').toLowerCase();
	if (kind === 'uniform') {
		return {
			kind: 'uniform',
			min: typeof range.min === 'number' ? range.min : undefined,
			max: typeof range.max === 'number' ? range.max : undefined
		};
	}

	if (kind === 'components') {
		const parseList = (value: unknown): number[] | undefined => {
			if (!Array.isArray(value)) {
				return undefined;
			}
			const parsed = value
				.map((entry) => Number(entry))
				.filter((entry) => Number.isFinite(entry));
			return parsed.length > 0 ? parsed : undefined;
		};

		return {
			kind: 'components',
			min: parseList(range.min),
			max: parseList(range.max)
		};
	}

	return undefined;
};

const fromRustConstraints = (constraints: RustUiParamDto['constraints']): UiParamConstraints => ({
	range: fromRustRangeConstraint(constraints.range),
	step: constraints.step,
	step_base: constraints.step_base,
	enum_options: (constraints.enum_options ?? []).map((option) => ({
		variant_id: option.variant_id,
		value: fromRustParamValue(option.value),
		label: option.label,
		tags: [...(option.tags ?? [])],
		ordering: option.ordering
	})),
	policy: constraints.policy,
	reference: fromRustReferenceConstraints(constraints.reference),
	file: fromRustFileConstraints(constraints.file)
});

const fromRustParam = (param: RustUiParamDto): UiParamDto => ({
	value: fromRustParamValue(param.value),
	default_value: fromRustParamValue(param.default_value ?? param.value),
	event_behaviour: param.event_behaviour,
	read_only: param.read_only,
	constraints: fromRustConstraints(param.constraints),
	ui_hints: { ...(param.ui_hints ?? {}) },
	reference_allowed_targets: [...(param.reference_allowed_targets ?? [])],
	reference_visible_nodes: [...(param.reference_visible_nodes ?? [])]
});

const fromRustNodeData = (data: RustUiNodeDto['data']): UiNodeDataDto => {
	if (data.kind === 'parameter') {
		return { kind: 'parameter', param: fromRustParam(data.param) };
	}
	return { kind: 'node', node_type: data.node_type };
};

const fromRustNode = (node: RustUiNodeDto): UiNodeDto => ({
	node_id: node.node_id,
	uuid: node.uuid,
	decl_id: node.decl_id,
	node_type: node.node_type,
	meta: {
		...node.meta,
		user_permissions: {
			can_edit_name: Boolean(node.meta.user_permissions?.can_edit_name),
			can_remove_and_duplicate: Boolean(
				node.meta.user_permissions?.can_remove_and_duplicate
			),
			can_edit_constraints: Boolean(node.meta.user_permissions?.can_edit_constraints),
			can_edit_tags: Boolean(node.meta.user_permissions?.can_edit_tags),
			can_edit_color: Boolean(node.meta.user_permissions?.can_edit_color)
		},
		tags: [...(node.meta.tags ?? [])]
	},
	data: fromRustNodeData(node.data),
	user_role: node.user_role ?? 'regular',
	user_item_kind: node.user_item_kind ?? node.node_type,
	accepted_user_item_kinds: [...(node.accepted_user_item_kinds ?? [])],
	creatable_user_items: [...(node.creatable_user_items ?? [])],
	children: [...node.children]
});

const fromRustEvent = (event: RustUiEventDto): UiEventDto => {
	if (!isRecord(event)) {
		return event as UiEventDto;
	}

	const nestedKind = event.kind;
	if (isRecord(nestedKind) && typeof nestedKind.kind === 'string') {
		if (nestedKind.kind === 'paramChanged') {
			return {
				...(event as Omit<UiEventDto, 'kind'>),
				kind: {
					kind: 'paramChanged',
					param: Number(nestedKind.param ?? 0),
					old_value: fromRustParamValue(nestedKind.old_value),
					new_value: fromRustParamValue(nestedKind.new_value)
				}
			};
		}
		return event as UiEventDto;
	}

	if (typeof nestedKind !== 'string') {
		return event as UiEventDto;
	}

	if (nestedKind === 'paramChanged') {
		return {
			...(event as Omit<UiEventDto, 'kind'>),
			kind: {
				kind: 'paramChanged',
				param: Number((event as Record<string, unknown>).param ?? 0),
				old_value: fromRustParamValue((event as Record<string, unknown>).old_value),
				new_value: fromRustParamValue((event as Record<string, unknown>).new_value)
			}
		};
	}

	const payload = { ...(event as Record<string, unknown>) };
	delete payload.time;
	delete payload.kind;
	return {
		...(event as Omit<UiEventDto, 'kind'>),
		kind: {
			kind: nestedKind,
			...(payload as Record<string, unknown>)
		} as UiEventDto['kind']
	};
};

export const fromRustSnapshot = (snapshot: RustUiSnapshot): UiSnapshot => ({
	protocol_version: snapshot.protocol_version,
	scope: fromRustScope(snapshot.scope),
	at: snapshot.at,
	nodes: snapshot.nodes.map(fromRustNode),
	schema: {
		node_types: snapshot.schema.node_types ?? [],
		enums: snapshot.schema.enums ?? []
	},
	history: snapshot.history ?? {
		can_undo: false,
		can_redo: false,
		undo_len: 0,
		redo_len: 0,
		active_edit_session: false
	},
	logger: {
		max_entries: snapshot.logger?.max_entries ?? 0,
		records: [...(snapshot.logger?.records ?? [])]
	}
});

export const fromRustEventBatch = (batch: RustUiEventBatch): UiEventBatch => ({
	from: batch.from,
	to: batch.to,
	events: batch.events.map(fromRustEvent)
});

export const fromRustReferenceTargets = (
	payload: RustReferenceTargetsResponse
): UiReferenceTargets => ({
	allowed_target_ids: [...(payload.allowed_targets ?? [])],
	visible_node_ids: [...(payload.visible_nodes ?? [])]
});

export const toRustIntent = (intent: UiEditIntent): unknown => {
	if (intent.kind === 'setParam') {
		return {
			...intent,
			value: toRustParamValue(intent.value)
		};
	}
	return intent;
};

const formatError = (context: string, response: Response, body: unknown): Error => {
	const suffix = isRecord(body) && typeof body.error === 'string' ? `: ${body.error}` : '';
	return new Error(`${context} failed with ${response.status} ${response.statusText}${suffix}`);
};

export const createHttpUiClient = (options: HttpClientOptions = {}): UiClient => {
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
	const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

	const postJson = async <TResponse>(path: string, payload: unknown): Promise<TResponse> => {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		let body: unknown = undefined;
		const text = await response.text();
		if (text.length > 0) {
			try {
				body = JSON.parse(text) as unknown;
			} catch {
				body = text;
			}
		}

		if (!response.ok) {
			throw formatError(`POST ${path}`, response, body);
		}

		return body as TResponse;
	};

	const client: UiClient = {
		async snapshot(scope: UiSubscriptionScope = wholeGraphScope): Promise<UiSnapshot> {
			const request: RustSnapshotRequest = { scope: toRustScope(scope) };
			const snapshot = await postJson<RustUiSnapshot>('/snapshot', request);
			return fromRustSnapshot(snapshot);
		},

		subscribe(
			scope: UiSubscriptionScope,
			from: EventTime | undefined,
			onBatch: (batch: UiEventBatch) => void
		): () => void {
			let cursor = from;
			let active = true;
			let inFlight = false;

			const poll = async (): Promise<void> => {
				if (!active || inFlight) {
					return;
				}
				inFlight = true;
				try {
					const batch = await client.replay(scope, cursor);
					if (!active) {
						return;
					}
					if (batch.events.length > 0) {
						onBatch(batch);
					}
					if (batch.to) {
						cursor = batch.to;
					}
				} catch (error) {
					console.error('ui subscribe replay polling failed', error);
				} finally {
					inFlight = false;
				}
			};

			const timer = setInterval(() => {
				void poll();
			}, pollIntervalMs);
			void poll();

			return () => {
				active = false;
				clearInterval(timer);
			};
		},

		async sendIntent(intent: UiEditIntent): Promise<UiAck> {
			const ack = await postJson<UiAck>('/intent', toRustIntent(intent));
			return ack;
		},

		async replay(scope: UiSubscriptionScope, from?: EventTime): Promise<UiEventBatch> {
			const request: RustReplayRequest = { scope: toRustScope(scope), from };
			const batch = await postJson<RustUiEventBatch>('/replay', request);
			return fromRustEventBatch(batch);
		},

		async referenceTargets(paramNodeId: number): Promise<UiReferenceTargets> {
			const request: RustReferenceTargetsRequest = { param: paramNodeId };
			const response = await postJson<RustReferenceTargetsResponse>(
				'/reference-targets',
				request
			);
			return fromRustReferenceTargets(response);
		},

		async scriptState(nodeId: number): Promise<UiScriptState> {
			const request: RustScriptStateRequest = { node: nodeId };
			const response = await postJson<RustScriptState>('/script-state', request);
			return fromRustScriptState(response);
		},

		async setScriptConfig(
			nodeId: number,
			config: UiScriptConfig,
			forceReload = false
		): Promise<void> {
			const request: RustScriptConfigRequest = {
				node: nodeId,
				config: toRustScriptConfig(config),
				force_reload: forceReload
			};
			await postJson<{ ok?: boolean }>('/script-config', request);
		},

		async reloadScript(nodeId: number): Promise<void> {
			const request: RustScriptReloadRequest = { node: nodeId };
			await postJson<{ ok?: boolean }>('/script-reload', request);
		}
	};

	return client;
};
