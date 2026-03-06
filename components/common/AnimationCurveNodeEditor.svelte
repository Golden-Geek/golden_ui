<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import {
		createUiEditSession,
		sendCreateUserItemIntent,
		sendRemoveNodeIntent,
		sendSetParamIntent,
		type UiEditSession
	} from '$lib/golden_ui/store/ui-intents';
	import type { NodeId, ParamValue, UiNodeDto, UiParamConstraints } from '$lib/golden_ui/types';
	import AnimationCurveCanvas from './AnimationCurveCanvas.svelte';

	type CurveEasingKind =
		| 'linear'
		| 'bezier'
		| 'hold'
		| 'steps'
		| 'shape'
		| 'perlinNoise'
		| 'random'
		| 'script';
	type CurveCoordinateSpace = 'relative' | 'absolute';
	type CurveStepMode = 'stepSize' | 'numSteps';
	type CurvePhaseMode = 'frequency' | 'numPhases';
	type CurveShape = 'sine' | 'triangle' | 'saw' | 'reverseSaw' | 'square';
	type CurveViewMode = 'adaptive' | 'fixed';

	interface ParamNodeRef {
		node_id: NodeId;
		value: ParamValue;
		enabled: boolean;
		constraints: UiParamConstraints;
	}

	interface CurveRangeConstraint {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
	}

	interface CurveRangeState {
		bounds: CurveRangeConstraint;
		active: boolean;
		range_node: UiNodeDto | null;
	}

	interface ParsedEasing {
		node_id: NodeId;
		kind: CurveEasingKind;
		params: Record<string, ParamNodeRef>;
	}

	interface ParsedCurveKey {
		node_id: NodeId;
		position: number;
		value: number;
		source_index: number;
		position_param?: ParamNodeRef;
		value_param?: ParamNodeRef;
		easing?: ParsedEasing;
	}

	interface CubicPolynomial {
		a: number;
		b: number;
		c: number;
		d: number;
	}

	type CompiledSegmentEasing =
		| { kind: 'linear' }
		| { kind: 'hold' }
		| {
				kind: 'bezier';
				x: CubicPolynomial;
				y: CubicPolynomial;
				start_position: number;
				inv_span: number;
		  }
		| { kind: 'steps'; steps: number }
		| {
				kind: 'shape';
				coordinate_space: CurveCoordinateSpace;
				shape: CurveShape;
				amplitude: number;
				phase_cycles: number;
				fade_in: number;
				fade_out: number;
		  }
		| {
				kind: 'perlinNoise';
				frequency: number;
				amplitude: number;
				octaves: number;
				fade_in: number;
				fade_out: number;
				phase: number;
				seed: number;
		  }
		| {
				kind: 'random';
				frequency: number;
				fade_in: number;
				fade_out: number;
				seed: number;
		  }
		| { kind: 'script'; source: string };

	interface CompiledCurveSegment {
		start_position: number;
		end_position: number;
		start_value: number;
		end_value: number;
		value_delta: number;
		inv_span: number;
		easing: CompiledSegmentEasing;
	}

	interface CompiledCurveKey {
		node_id: NodeId;
		position: number;
		value: number;
		easing?: ParsedEasing;
	}

	interface CompiledCurve {
		keys: CompiledCurveKey[];
		segments: CompiledCurveSegment[];
	}

	interface CanvasTransform {
		plot_left: number;
		plot_top: number;
		plot_width: number;
		plot_height: number;
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
		key_screen_points: Map<NodeId, { x: number; y: number }>;
		curve_screen_x: Float64Array;
		curve_screen_y: Float64Array;
		curve_owner_key_ids: Array<NodeId | null>;
	}

	interface DragPreview {
		position: number;
		value: number;
	}

	type BezierHandleKind = 'out' | 'in';

	interface BezierHandleRef {
		key_id: NodeId;
		kind: BezierHandleKind;
	}

	interface BezierHandleSegment {
		start_key_id: NodeId;
		end_key_id: NodeId;
		key_id: NodeId;
		coordinate_space: CurveCoordinateSpace;
		start_position: number;
		start_value: number;
		end_position: number;
		end_value: number;
		span: number;
		out_position: number;
		out_value: number;
		in_position: number;
		in_value: number;
		out_curve_position: number;
		out_curve_value: number;
		in_curve_position: number;
		in_curve_value: number;
		params: Record<string, ParamNodeRef>;
	}

	interface BezierHandleControl {
		ref: BezierHandleRef;
		anchor_key_id: NodeId;
		anchor_position: number;
		anchor_value: number;
		handle_position: number;
		handle_value: number;
		coordinate_space: CurveCoordinateSpace;
		segment_start_position: number;
		segment_end_position: number;
		span: number;
		params: Record<string, ParamNodeRef>;
	}

	interface BezierHandleVisual {
		key_id: NodeId;
		kind: BezierHandleKind;
		anchor_position: number;
		anchor_value: number;
		handle_position: number;
		handle_value: number;
	}

	interface BezierEasingPreview {
		out_position: number;
		out_value: number;
		in_position: number;
		in_value: number;
	}

	interface PendingCreateTarget {
		known_key_ids: Set<NodeId>;
		position: number;
		value: number;
		edit_session: UiEditSession | null;
	}

	interface ActiveKeyDrag {
		pointer_id: number;
		anchor_key_id: NodeId;
		anchor_start_position: number;
		anchor_start_value: number;
		origins: Array<{ key_id: NodeId; position: number; value: number }>;
	}

	interface ActiveBezierHandleDrag {
		pointer_id: number;
		ref: BezierHandleRef;
		opposite_ref: BezierHandleRef | null;
		opposite_length: number;
		touched_key_ids: Set<NodeId>;
	}

	interface ActiveCanvasPan {
		pointer_id: number;
		start_screen_x: number;
		start_screen_y: number;
		start_bounds: CurveViewBounds;
	}

	interface CurveViewBounds {
		x_min: number;
		x_max: number;
		y_min: number;
		y_max: number;
	}

	let {
		curveNode,
		selected_key_id = $bindable<NodeId | null>(null),
		selected_key_ids = $bindable<NodeId[]>([]),
		showToolbar = true,
		showHints = true,
		showGrid = true,
		showNumbers = true,
		showBounds = true,
		canvasHeight = 'min(26rem, 38vh)'
	}: {
		curveNode: UiNodeDto;
		selected_key_id?: NodeId | null;
		selected_key_ids?: NodeId[];
		showToolbar?: boolean;
		showHints?: boolean;
		showGrid?: boolean;
		showNumbers?: boolean;
		showBounds?: boolean;
		canvasHeight?: string;
	} = $props();

	const CURVE_NODE_TYPE = 'animation_curve';
	const KEY_NODE_TYPE = 'animation_curve_key';
	const KEY_ITEM_KIND = 'animation_curve_key';
	const EASING_NODE_TYPE = 'animation_curve_easing';
	const RANGE_NODE_TYPE = 'animation_curve_range';

	const DECL_POSITION = 'position';
	const DECL_VALUE = 'value';
	const DECL_EASING = 'easing';
	const DECL_RANGE = 'range';
	const DECL_RANGE_X = 'x';
	const DECL_RANGE_Y = 'y';
	const DECL_KIND = 'kind';
	const DECL_COORDINATE_SPACE = 'coordinate_space';
	const DECL_OUT_POSITION = 'out_position';
	const DECL_OUT_VALUE = 'out_value';
	const DECL_IN_POSITION = 'in_position';
	const DECL_IN_VALUE = 'in_value';
	const DECL_STEP_MODE = 'step_mode';
	const DECL_STEP_SIZE = 'step_size';
	const DECL_NUM_STEPS = 'num_steps';
	const DECL_SHAPE = 'shape';
	const DECL_AMPLITUDE = 'amplitude';
	const DECL_PHASE_MODE = 'phase_mode';
	const DECL_FREQUENCY = 'frequency';
	const DECL_NUM_PHASES = 'num_phases';
	const DECL_FADE_IN = 'fade_in';
	const DECL_FADE_OUT = 'fade_out';
	const DECL_OCTAVES = 'octaves';
	const DECL_PHASE = 'phase';
	const DECL_SEED = 'seed';
	const DECL_SCRIPT_SOURCE = 'script_source';

	const CURVE_EPSILON = 1e-12;
	const MAX_PERLIN_OCTAVES = 12;
	const MIN_VIEW_SPAN = 1e-6;
	const MAX_VIEW_SPAN = 1e9;

	let session = $derived(appState.session);
	let graphNodesById = $derived(session?.graph.state.nodesById ?? null);
	let liveNode: UiNodeDto = $derived(session?.graph.state.nodesById.get(curveNode.node_id) ?? curveNode);

	let rem_base_px = $state(16);
	let hover_key_id = $state<NodeId | null>(null);
	let hover_bezier_handle = $state<BezierHandleRef | null>(null);
	let drag_preview_by_key_id = $state<Map<NodeId, DragPreview>>(new Map());
	let easing_drag_preview_by_key_id = $state<Map<NodeId, BezierEasingPreview>>(new Map());
	let pending_create_target = $state<PendingCreateTarget | null>(null);
	let adding_key = $state(false);
	let curve_view_mode = $state<CurveViewMode>('adaptive');
	let fixed_view_bounds = $state<CurveViewBounds | null>(null);
	let canvas_element = $state<HTMLCanvasElement | null>(null);
	let active_drag = $state<ActiveKeyDrag | null>(null);
	let active_bezier_handle_drag = $state<ActiveBezierHandleDrag | null>(null);
	let active_canvas_pan = $state<ActiveCanvasPan | null>(null);
	let drag_edit_session = $state<UiEditSession | null>(null);
	let drag_edit_session_begin_promise: Promise<void> | null = null;
	let hover_curve_position = $state<{ position: number; value: number } | null>(null);

	let interaction_transform = $state<CanvasTransform | null>(null);
	let queued_drag_targets: Map<NodeId, DragPreview> | null = null;
	let queued_bezier_handle_targets: Map<NodeId, BezierEasingPreview> | null = null;
	let drag_commit_raf_id = 0;
	let pending_param_write_promises: Set<Promise<void>> = new Set();
	const float_bits_view = new DataView(new ArrayBuffer(8));

	const clamp = (value: number, min: number, max: number): number =>
		Math.min(max, Math.max(min, value));
	const finite_or = (value: number, fallback: number): number =>
		Number.isFinite(value) ? value : fallback;
	const param_number_value = (value: ParamValue | undefined, fallback: number): number => {
		if (!value) {
			return fallback;
		}
		if (value.kind === 'float') {
			return finite_or(value.value, fallback);
		}
		if (value.kind === 'int') {
			return finite_or(value.value, fallback);
		}
		return fallback;
	};
	const param_string_value = (value: ParamValue | undefined, fallback: string): string => {
		if (!value) {
			return fallback;
		}
		if (value.kind === 'enum') {
			return value.value.trim();
		}
		if (value.kind === 'str') {
			return value.value;
		}
		return fallback;
	};
	const normalize_easing_kind = (value: string): CurveEasingKind => {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'bezier') {
			return 'bezier';
		}
		if (normalized === 'hold') {
			return 'hold';
		}
		if (normalized === 'steps') {
			return 'steps';
		}
		if (normalized === 'shape') {
			return 'shape';
		}
		if (normalized === 'perlinnoise') {
			return 'perlinNoise';
		}
		if (normalized === 'random') {
			return 'random';
		}
		if (normalized === 'script') {
			return 'script';
		}
		return 'linear';
	};
	const normalize_coordinate_space = (value: string): CurveCoordinateSpace =>
		value.trim().toLowerCase() === 'absolute' ? 'absolute' : 'relative';
	const normalize_step_mode = (value: string): CurveStepMode =>
		value.trim().toLowerCase() === 'stepsize' ? 'stepSize' : 'numSteps';
	const normalize_shape = (value: string): CurveShape => {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'triangle') {
			return 'triangle';
		}
		if (normalized === 'saw') {
			return 'saw';
		}
		if (normalized === 'reversesaw') {
			return 'reverseSaw';
		}
		if (normalized === 'square') {
			return 'square';
		}
		return 'sine';
	};
	const normalize_phase_mode = (value: string): CurvePhaseMode =>
		value.trim().toLowerCase() === 'numphases' ? 'numPhases' : 'frequency';
	const normalize_bounds_pair = (
		min_candidate: number,
		max_candidate: number
	): { min: number; max: number } | null => {
		if (!Number.isFinite(min_candidate) || !Number.isFinite(max_candidate)) {
			return null;
		}
		const min = Math.min(min_candidate, max_candidate);
		const max = Math.max(min_candidate, max_candidate);
		if (max - min <= CURVE_EPSILON) {
			return null;
		}
		return { min, max };
	};
	const make_curve_range_constraint = (
		x_min_candidate: number,
		x_max_candidate: number,
		y_min_candidate: number,
		y_max_candidate: number
	): CurveRangeConstraint | null => {
		const x_bounds = normalize_bounds_pair(x_min_candidate, x_max_candidate);
		const y_bounds = normalize_bounds_pair(y_min_candidate, y_max_candidate);
		if (!x_bounds || !y_bounds) {
			return null;
		}
		return {
			x_min: x_bounds.min,
			x_max: x_bounds.max,
			y_min: y_bounds.min,
			y_max: y_bounds.max
		};
	};
	const range_bounds_from_value = (
		value: ParamValue | undefined
	): { min: number; max: number } | null => {
		if (!value || value.kind !== 'vec2') {
			return null;
		}
		return normalize_bounds_pair(value.value[0], value.value[1]);
	};
	const uniform_bounds_from_constraints = (
		constraints: UiParamConstraints | undefined
	): { min: number; max: number } | null => {
		const range = constraints?.range;
		if (!range || range.kind !== 'uniform') {
			return null;
		}
		if (range.min === undefined || range.max === undefined) {
			return null;
		}
		return normalize_bounds_pair(range.min, range.max);
	};

	const cubic_from_points = (p0: number, p1: number, p2: number, p3: number): CubicPolynomial => ({
		a: -p0 + 3 * p1 - 3 * p2 + p3,
		b: 3 * p0 - 6 * p1 + 3 * p2,
		c: -3 * p0 + 3 * p1,
		d: p0
	});
	const sample_cubic = (poly: CubicPolynomial, t: number): number =>
		((poly.a * t + poly.b) * t + poly.c) * t + poly.d;
	const derivative_cubic = (poly: CubicPolynomial, t: number): number =>
		(3 * poly.a * t + 2 * poly.b) * t + poly.c;

	const smoothstep = (value: number): number => value * value * (3 - 2 * value);
	const stable_mix_u32 = (value: number): number => {
		let mixed = value >>> 0;
		mixed ^= mixed >>> 16;
		mixed = Math.imul(mixed, 0x7feb352d);
		mixed ^= mixed >>> 15;
		mixed = Math.imul(mixed, 0x846ca68b);
		mixed ^= mixed >>> 16;
		return mixed >>> 0;
	};
	const hash_i32 = (value: number, seed: number): number => {
		const base = (value | 0) + Math.imul(seed | 0, 0x9e3779b9);
		return stable_mix_u32(base);
	};
	const hash_to_unit = (hash: number): number => (hash >>> 0) / 0xffffffff;
	const float_position_seed = (value: number): number => {
		float_bits_view.setFloat64(0, value, true);
		const low = float_bits_view.getUint32(0, true);
		const high = float_bits_view.getUint32(4, true);
		return stable_mix_u32(low ^ ((high << 1) | (high >>> 31)));
	};
	const value_noise_1d = (position: number, seed: number): number => {
		const left = Math.floor(position);
		const right = left + 1;
		const local = clamp(position - left, 0, 1);
		const weight = smoothstep(local);
		const left_value = hash_to_unit(hash_i32(left, seed)) * 2 - 1;
		const right_value = hash_to_unit(hash_i32(right, seed)) * 2 - 1;
		return left_value + (right_value - left_value) * weight;
	};
	const fractal_noise_1d = (position: number, octaves: number, seed: number): number => {
		if (!Number.isFinite(position)) {
			return 0;
		}

		let frequency = 1;
		let amplitude = 1;
		let total = 0;
		let normalization = 0;
		const octave_count = Math.max(1, Math.min(MAX_PERLIN_OCTAVES, Math.round(octaves)));
		for (let octave = 0; octave < octave_count; octave += 1) {
			const octave_seed = stable_mix_u32(seed ^ Math.imul(octave + 1, 0x9e3779b9));
			total += value_noise_1d(position * frequency, octave_seed) * amplitude;
			normalization += amplitude;
			frequency *= 2;
			amplitude *= 0.5;
		}
		if (normalization <= CURVE_EPSILON) {
			return 0;
		}
		return total / normalization;
	};
	const fade_envelope = (progress: number, fade_in: number, fade_out: number): number => {
		let envelope = 1;
		if (fade_in > CURVE_EPSILON) {
			envelope = Math.min(envelope, clamp(progress / fade_in, 0, 1));
		}
		if (fade_out > CURVE_EPSILON) {
			envelope = Math.min(envelope, clamp((1 - progress) / fade_out, 0, 1));
		}
		return clamp(envelope, 0, 1);
	};
	const shape_wave = (shape: CurveShape, phase_cycles: number): number => {
		const phase = ((phase_cycles % 1) + 1) % 1;
		if (shape === 'triangle') {
			return 1 - 4 * Math.abs(phase - 0.5);
		}
		if (shape === 'saw') {
			return 2 * phase - 1;
		}
		if (shape === 'reverseSaw') {
			return 1 - 2 * phase;
		}
		if (shape === 'square') {
			return phase < 0.5 ? 1 : -1;
		}
		return Math.sin(phase * Math.PI * 2);
	};

	const to_param_ref = (candidate: UiNodeDto | undefined): ParamNodeRef | undefined => {
		if (!candidate || candidate.data.kind !== 'parameter') {
			return undefined;
		}
		return {
			node_id: candidate.node_id,
			value: candidate.data.param.value,
			enabled: candidate.meta.enabled,
			constraints: candidate.data.param.constraints
		};
	};

	const compile_curve = (parsed_keys: ParsedCurveKey[]): CompiledCurve => {
		const normalized: CompiledCurveKey[] = parsed_keys
			.filter((key) => Number.isFinite(key.position) && Number.isFinite(key.value))
			.map((key) => ({
				node_id: key.node_id,
				position: key.position,
				value: key.value,
				easing: key.easing
			}))
			.sort((left, right) => left.position - right.position || left.node_id - right.node_id);

		if (normalized.length > 1) {
			const deduplicated: CompiledCurveKey[] = [];
			for (const key of normalized) {
				const previous = deduplicated[deduplicated.length - 1];
				if (previous && Math.abs(previous.position - key.position) <= CURVE_EPSILON) {
					deduplicated[deduplicated.length - 1] = key;
					continue;
				}
				deduplicated.push(key);
			}
			normalized.splice(0, normalized.length, ...deduplicated);
		}

		const segments: CompiledCurveSegment[] = [];
		for (let index = 0; index + 1 < normalized.length; index += 1) {
			const start = normalized[index];
			const end = normalized[index + 1];
			const span = end.position - start.position;
			if (span <= CURVE_EPSILON) {
				continue;
			}

			const params = start.easing?.params ?? {};
			const easing_kind =
				start.easing?.kind ??
				normalize_easing_kind(param_string_value(params[DECL_KIND]?.value, 'linear'));

			let easing: CompiledSegmentEasing = { kind: 'linear' };
			if (easing_kind === 'hold') {
				easing = { kind: 'hold' };
			} else if (easing_kind === 'bezier') {
				const coordinate_space = normalize_coordinate_space(
					param_string_value(params[DECL_COORDINATE_SPACE]?.value, 'relative')
				);
				const out_position = param_number_value(params[DECL_OUT_POSITION]?.value, 1 / 3);
				const out_value = param_number_value(params[DECL_OUT_VALUE]?.value, 1 / 3);
				const in_position = param_number_value(params[DECL_IN_POSITION]?.value, -1 / 3);
				const in_value = param_number_value(params[DECL_IN_VALUE]?.value, -1 / 3);

				const value_span = end.value - start.value;
				let p1x = 0;
				let p2x = 0;
				let p1y = 0;
				let p2y = 0;
				if (coordinate_space === 'relative') {
					p1x = finite_or(start.position + out_position * span, start.position + span / 3);
					p2x = finite_or(end.position + in_position * span, start.position + (span * 2) / 3);
					p1y = finite_or(start.value + out_value, start.value + value_span / 3);
					p2y = finite_or(end.value + in_value, start.value + (value_span * 2) / 3);
				} else {
					p1x = finite_or(out_position, start.position + span / 3);
					p2x = finite_or(in_position, start.position + (span * 2) / 3);
					p1y = finite_or(start.value + out_value, start.value + value_span / 3);
					p2y = finite_or(end.value + in_value, start.value + (value_span * 2) / 3);
				}
				p1x = clamp(p1x, start.position, end.position);
				p2x = clamp(p2x, start.position, end.position);
				if (p2x < p1x) {
					const temporary = p1x;
					p1x = p2x;
					p2x = temporary;
				}
				easing = {
					kind: 'bezier',
					x: cubic_from_points(start.position, p1x, p2x, end.position),
					y: cubic_from_points(start.value, p1y, p2y, end.value),
					start_position: start.position,
					inv_span: 1 / span
				};
			} else if (easing_kind === 'steps') {
				const step_mode = normalize_step_mode(
					param_string_value(params[DECL_STEP_MODE]?.value, 'numSteps')
				);
				let steps = Math.max(1, param_number_value(params[DECL_NUM_STEPS]?.value, 8));
				if (step_mode === 'stepSize') {
					const step_size = Math.max(
						CURVE_EPSILON,
						Math.abs(param_number_value(params[DECL_STEP_SIZE]?.value, 0.1))
					);
					steps = Math.max(1, Math.ceil(Math.abs(span) / step_size));
				}
				easing = {
					kind: 'steps',
					steps
				};
			} else if (easing_kind === 'shape') {
				const coordinate_space = normalize_coordinate_space(
					param_string_value(params[DECL_COORDINATE_SPACE]?.value, 'relative')
				);
				const phase_mode = normalize_phase_mode(
					param_string_value(params[DECL_PHASE_MODE]?.value, 'frequency')
				);
				const shape = normalize_shape(param_string_value(params[DECL_SHAPE]?.value, 'sine'));
				const amplitude = param_number_value(params[DECL_AMPLITUDE]?.value, 1);
				const frequency = Math.abs(param_number_value(params[DECL_FREQUENCY]?.value, 1));
				const num_phases = Math.abs(param_number_value(params[DECL_NUM_PHASES]?.value, 1));
				const phase_cycles = phase_mode === 'frequency' ? frequency * Math.abs(span) : num_phases;
				easing = {
					kind: 'shape',
					coordinate_space,
					shape,
					amplitude,
					phase_cycles,
					fade_in: Math.max(0, param_number_value(params[DECL_FADE_IN]?.value, 0)),
					fade_out: Math.max(0, param_number_value(params[DECL_FADE_OUT]?.value, 0))
				};
			} else if (easing_kind === 'perlinNoise') {
				easing = {
					kind: 'perlinNoise',
					frequency: Math.abs(param_number_value(params[DECL_FREQUENCY]?.value, 1)),
					amplitude: param_number_value(params[DECL_AMPLITUDE]?.value, 1),
					octaves: clamp(param_number_value(params[DECL_OCTAVES]?.value, 4), 1, MAX_PERLIN_OCTAVES),
					fade_in: Math.max(0, param_number_value(params[DECL_FADE_IN]?.value, 0)),
					fade_out: Math.max(0, param_number_value(params[DECL_FADE_OUT]?.value, 0)),
					phase: param_number_value(params[DECL_PHASE]?.value, 0),
					seed: stable_mix_u32(
						float_position_seed(start.position) ^ ((float_position_seed(end.position) << 17) >>> 0)
					)
				};
			} else if (easing_kind === 'random') {
				easing = {
					kind: 'random',
					frequency: Math.abs(param_number_value(params[DECL_FREQUENCY]?.value, 6)),
					fade_in: Math.max(0, param_number_value(params[DECL_FADE_IN]?.value, 0)),
					fade_out: Math.max(0, param_number_value(params[DECL_FADE_OUT]?.value, 0)),
					seed: Math.round(param_number_value(params[DECL_SEED]?.value, 0))
				};
			} else if (easing_kind === 'script') {
				easing = {
					kind: 'script',
					source: param_string_value(params[DECL_SCRIPT_SOURCE]?.value, '')
				};
			}

			segments.push({
				start_position: start.position,
				end_position: end.position,
				start_value: start.value,
				end_value: end.value,
				value_delta: end.value - start.value,
				inv_span: 1 / span,
				easing
			});
		}

		return {
			keys: normalized,
			segments
		};
	};

	const sample_bezier = (
		position: number,
		x: CubicPolynomial,
		y: CubicPolynomial,
		start_position: number,
		inv_span: number
	): number => {
		let t = clamp((position - start_position) * inv_span, 0, 1);
		for (let iteration = 0; iteration < 4; iteration += 1) {
			const sampled_x = sample_cubic(x, t);
			const delta = sampled_x - position;
			if (Math.abs(delta) <= 1e-8) {
				break;
			}
			const derivative = derivative_cubic(x, t);
			if (Math.abs(derivative) <= CURVE_EPSILON) {
				break;
			}
			t = clamp(t - delta / derivative, 0, 1);
		}

		let low = 0;
		let high = 1;
		for (let iteration = 0; iteration < 8; iteration += 1) {
			const midpoint = (low + high) * 0.5;
			const sampled_x = sample_cubic(x, midpoint);
			if (sampled_x <= position) {
				low = midpoint;
			} else {
				high = midpoint;
			}
		}
		t = (low + high) * 0.5;
		return sample_cubic(y, t);
	};

	const sample_segment = (segment: CompiledCurveSegment, position: number): number => {
		if (position <= segment.start_position) {
			return segment.start_value;
		}
		if (position >= segment.end_position) {
			return segment.end_value;
		}

		const progress = clamp((position - segment.start_position) * segment.inv_span, 0, 1);
		const linear_value = segment.start_value + segment.value_delta * progress;
		const easing = segment.easing;

		if (easing.kind === 'linear') {
			return linear_value;
		}
		if (easing.kind === 'hold') {
			return segment.start_value;
		}
		if (easing.kind === 'bezier') {
			return sample_bezier(position, easing.x, easing.y, easing.start_position, easing.inv_span);
		}
		if (easing.kind === 'steps') {
			const steps = Math.max(1, easing.steps);
			const step_index = clamp(Math.floor(progress * steps), 0, steps);
			const stepped_progress = clamp(step_index / steps, 0, 1);
			return segment.start_value + segment.value_delta * stepped_progress;
		}
		if (easing.kind === 'shape') {
			const envelope = fade_envelope(progress, easing.fade_in, easing.fade_out);
			const wave = shape_wave(easing.shape, easing.phase_cycles * progress);
			return linear_value + easing.amplitude * wave * envelope;
		}
		if (easing.kind === 'perlinNoise') {
			if (easing.frequency <= CURVE_EPSILON || Math.abs(easing.amplitude) <= CURVE_EPSILON) {
				return linear_value;
			}
			const envelope = fade_envelope(progress, easing.fade_in, easing.fade_out);
			const noise_position = position * easing.frequency + easing.phase;
			const noise = fractal_noise_1d(noise_position, easing.octaves, easing.seed);
			return linear_value + noise * easing.amplitude * envelope;
		}
		if (easing.kind === 'random') {
			if (easing.frequency <= CURVE_EPSILON) {
				return linear_value;
			}
			const envelope = fade_envelope(progress, easing.fade_in, easing.fade_out);
			const bucket = Math.floor((position - segment.start_position) * easing.frequency);
			const random_progress = hash_to_unit(hash_i32(bucket, easing.seed));
			const random_value = segment.start_value + segment.value_delta * random_progress;
			return linear_value + (random_value - linear_value) * envelope;
		}
		return linear_value;
	};

	const sample_compiled_curve = (
		compiled_curve: CompiledCurve,
		position: number
	): number | null => {
		const keys = compiled_curve.keys;
		if (keys.length === 0 || !Number.isFinite(position)) {
			return null;
		}
		if (keys.length === 1) {
			return keys[0].value;
		}
		const first = keys[0];
		const last = keys[keys.length - 1];
		if (position <= first.position) {
			return first.value;
		}
		if (position >= last.position) {
			return last.value;
		}

		const segments = compiled_curve.segments;
		if (segments.length === 0) {
			return first.value;
		}

		let low = 0;
		let high = segments.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (segments[middle].end_position <= position) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		const segment_index = Math.min(low, segments.length - 1);
		return sample_segment(segments[segment_index], position);
	};

	const set_numeric_param = async (ref: ParamNodeRef | undefined, value: number): Promise<void> => {
		const operation = (async (): Promise<void> => {
			if (!ref || !Number.isFinite(value)) {
				return;
			}
			if (ref.value.kind === 'int') {
				await sendSetParamIntent(ref.node_id, { kind: 'int', value: Math.round(value) }, 'Append');
				return;
			}
			await sendSetParamIntent(ref.node_id, { kind: 'float', value }, 'Append');
		})();
		pending_param_write_promises.add(operation);
		void operation.finally(() => {
			pending_param_write_promises.delete(operation);
		});
		await operation;
	};

	const clamp_curve_position_to_active_range = (position: number): number => {
		const active_range = active_curve_range_constraint;
		if (!active_range || !Number.isFinite(position)) {
			return position;
		}
		return clamp(position, active_range.x_min, active_range.x_max);
	};

	const clamp_curve_value_to_active_range = (value: number): number => {
		const active_range = active_curve_range_constraint;
		if (!active_range || !Number.isFinite(value)) {
			return value;
		}
		return clamp(value, active_range.y_min, active_range.y_max);
	};

	const clamp_curve_point_to_active_range = (
		position: number,
		value: number
	): { position: number; value: number } => ({
		position: clamp_curve_position_to_active_range(position),
		value: clamp_curve_value_to_active_range(value)
	});

	const same_node_id_array = (left: NodeId[], right: NodeId[]): boolean => {
		if (left.length !== right.length) {
			return false;
		}
		for (let index = 0; index < left.length; index += 1) {
			if (left[index] !== right[index]) {
				return false;
			}
		}
		return true;
	};

	const has_selected_key = (key_id: NodeId): boolean => selected_key_ids.includes(key_id);

	const set_single_selected_key = (key_id: NodeId | null): void => {
		selected_key_id = key_id;
		selected_key_ids = key_id === null ? [] : [key_id];
	};

	const add_selected_key = (key_id: NodeId): void => {
		if (has_selected_key(key_id)) {
			if (selected_key_id === null) {
				selected_key_id = key_id;
			}
			return;
		}
		selected_key_ids = [...selected_key_ids, key_id];
		if (selected_key_id === null) {
			selected_key_id = key_id;
		}
	};

	const toggle_selected_key = (key_id: NodeId): void => {
		if (!has_selected_key(key_id)) {
			add_selected_key(key_id);
			selected_key_id = key_id;
			return;
		}
		const next = selected_key_ids.filter((entry) => entry !== key_id);
		selected_key_ids = next;
		if (selected_key_id === key_id) {
			selected_key_id = next[0] ?? null;
		}
	};

	const set_drag_preview = (key_id: NodeId, position: number, value: number): void => {
		const clamped = clamp_curve_point_to_active_range(position, value);
		const next = new Map(drag_preview_by_key_id);
		next.set(key_id, { position: clamped.position, value: clamped.value });
		drag_preview_by_key_id = next;
	};

	const clear_drag_preview = (key_id: NodeId): void => {
		if (!drag_preview_by_key_id.has(key_id)) {
			return;
		}
		const next = new Map(drag_preview_by_key_id);
		next.delete(key_id);
		drag_preview_by_key_id = next;
	};

	const set_easing_drag_preview = (key_id: NodeId, preview: BezierEasingPreview): void => {
		const next = new Map(easing_drag_preview_by_key_id);
		next.set(key_id, preview);
		easing_drag_preview_by_key_id = next;
	};

	const clear_easing_drag_preview = (key_id: NodeId): void => {
		if (!easing_drag_preview_by_key_id.has(key_id)) {
			return;
		}
		const next = new Map(easing_drag_preview_by_key_id);
		next.delete(key_id);
		easing_drag_preview_by_key_id = next;
	};

	const override_numeric_param_ref = (
		ref: ParamNodeRef | undefined,
		value: number | undefined
	): ParamNodeRef | undefined => {
		if (!ref || value === undefined || !Number.isFinite(value)) {
			return ref;
		}
		if (ref.value.kind === 'int') {
			return {
				...ref,
				value: { kind: 'int', value: Math.round(value) }
			};
		}
		if (ref.value.kind === 'float') {
			return {
				...ref,
				value: { kind: 'float', value }
			};
		}
		return ref;
	};

	let parsed_keys = $derived.by((): ParsedCurveKey[] => {
		const nodes_by_id = graphNodesById;
		if (!nodes_by_id || liveNode.node_type !== CURVE_NODE_TYPE) {
			return [];
		}

		const parsed: ParsedCurveKey[] = [];
		for (let source_index = 0; source_index < liveNode.children.length; source_index += 1) {
			const child_id = liveNode.children[source_index];
			const key_node = nodes_by_id.get(child_id);
			if (!key_node || key_node.node_type !== KEY_NODE_TYPE) {
				continue;
			}

			let position_param: ParamNodeRef | undefined;
			let value_param: ParamNodeRef | undefined;
			let easing: ParsedEasing | undefined;

			for (const key_child_id of key_node.children) {
				const key_child = nodes_by_id.get(key_child_id);
				if (!key_child) {
					continue;
				}
				const decl_id = key_child.decl_id;
				if (decl_id === DECL_POSITION) {
					position_param = to_param_ref(key_child);
					continue;
				}
				if (decl_id === DECL_VALUE) {
					value_param = to_param_ref(key_child);
					continue;
				}
				if (decl_id === DECL_EASING && key_child.node_type === EASING_NODE_TYPE) {
					const easing_params: Record<string, ParamNodeRef> = {};
					for (const easing_child_id of key_child.children) {
						const easing_child = nodes_by_id.get(easing_child_id);
						const param_ref = to_param_ref(easing_child);
						if (!easing_child || !param_ref) {
							continue;
						}
						easing_params[easing_child.decl_id] = param_ref;
					}
					easing = {
						node_id: key_child.node_id,
						kind: normalize_easing_kind(
							param_string_value(easing_params[DECL_KIND]?.value, 'linear')
						),
						params: easing_params
					};
				}
			}

			const easing_preview = easing_drag_preview_by_key_id.get(key_node.node_id);
			if (easing && easing.kind === 'bezier' && easing_preview) {
				const next_params: Record<string, ParamNodeRef> = { ...easing.params };
				const next_out_position = override_numeric_param_ref(
					easing.params[DECL_OUT_POSITION],
					easing_preview.out_position
				);
				if (next_out_position) {
					next_params[DECL_OUT_POSITION] = next_out_position;
				}
				const next_out_value = override_numeric_param_ref(
					easing.params[DECL_OUT_VALUE],
					easing_preview.out_value
				);
				if (next_out_value) {
					next_params[DECL_OUT_VALUE] = next_out_value;
				}
				const next_in_position = override_numeric_param_ref(
					easing.params[DECL_IN_POSITION],
					easing_preview.in_position
				);
				if (next_in_position) {
					next_params[DECL_IN_POSITION] = next_in_position;
				}
				const next_in_value = override_numeric_param_ref(
					easing.params[DECL_IN_VALUE],
					easing_preview.in_value
				);
				if (next_in_value) {
					next_params[DECL_IN_VALUE] = next_in_value;
				}
				easing = {
					...easing,
					params: next_params
				};
			}

			let position = param_number_value(position_param?.value, 0);
			let value = param_number_value(value_param?.value, 0);
			const drag_preview = drag_preview_by_key_id.get(key_node.node_id);
			if (drag_preview) {
				position = drag_preview.position;
				value = drag_preview.value;
			}

			parsed.push({
				node_id: key_node.node_id,
				position,
				value,
				source_index,
				position_param,
				value_param,
				easing
			});
		}

		parsed.sort(
			(left, right) => left.position - right.position || left.source_index - right.source_index
		);
		return parsed;
	});

	let parsed_key_by_id = $derived.by(
		(): Map<NodeId, ParsedCurveKey> => new Map(parsed_keys.map((entry) => [entry.node_id, entry]))
	);

	const resolve_bezier_handle_segment = (
		start: ParsedCurveKey,
		end: ParsedCurveKey
	): BezierHandleSegment | null => {
		const easing = start.easing;
		if (!easing || easing.kind !== 'bezier') {
			return null;
		}
		const span = end.position - start.position;
		if (!(span > CURVE_EPSILON)) {
			return null;
		}
		const params = easing.params;
		const coordinate_space = normalize_coordinate_space(
			param_string_value(params[DECL_COORDINATE_SPACE]?.value, 'relative')
		);
		const out_position = param_number_value(params[DECL_OUT_POSITION]?.value, 1 / 3);
		const out_value = param_number_value(params[DECL_OUT_VALUE]?.value, 1 / 3);
		const in_position = param_number_value(params[DECL_IN_POSITION]?.value, -1 / 3);
		const in_value = param_number_value(params[DECL_IN_VALUE]?.value, -1 / 3);

		let out_curve_position = 0;
		let out_curve_value = 0;
		let in_curve_position = 0;
		let in_curve_value = 0;
		if (coordinate_space === 'relative') {
			out_curve_position = finite_or(
				start.position + out_position * span,
				start.position + span / 3
			);
			out_curve_value = finite_or(start.value + out_value, start.value + 1 / 3);
			in_curve_position = finite_or(
				end.position + in_position * span,
				start.position + (span * 2) / 3
			);
			in_curve_value = finite_or(end.value + in_value, end.value - 1 / 3);
		} else {
			out_curve_position = finite_or(out_position, start.position + span / 3);
			out_curve_value = finite_or(start.value + out_value, start.value + 1 / 3);
			in_curve_position = finite_or(in_position, start.position + (span * 2) / 3);
			in_curve_value = finite_or(end.value + in_value, end.value - 1 / 3);
		}

		out_curve_position = clamp(out_curve_position, start.position, end.position);
		in_curve_position = clamp(in_curve_position, start.position, end.position);

		return {
			start_key_id: start.node_id,
			end_key_id: end.node_id,
			key_id: start.node_id,
			coordinate_space,
			start_position: start.position,
			start_value: start.value,
			end_position: end.position,
			end_value: end.value,
			span,
			out_position,
			out_value,
			in_position,
			in_value,
			out_curve_position,
			out_curve_value,
			in_curve_position,
			in_curve_value,
			params
		};
	};

	let selected_curve_owner_key_ids = $derived.by((): NodeId[] => {
		const selected = selected_key_ids.length > 0
			? selected_key_ids
			: selected_key_id === null
				? []
				: [selected_key_id];
		if (selected.length === 0) {
			return [];
		}
		const available = new Set(parsed_keys.map((entry) => entry.node_id));
		return selected.filter((key_id) => available.has(key_id));
	});

	let bezier_visible_anchor_key_ids = $derived.by((): NodeId[] => {
		if (selected_curve_owner_key_ids.length === 0) {
			return [];
		}
		const owner_set = new Set(selected_curve_owner_key_ids);
		const visible = new Set<NodeId>(selected_curve_owner_key_ids);
		for (let index = 0; index + 1 < parsed_keys.length; index += 1) {
			const start = parsed_keys[index];
			const end = parsed_keys[index + 1];
			if (!owner_set.has(start.node_id)) {
				continue;
			}
			// Selected curve/key means current and next anchors are involved.
			visible.add(end.node_id);
		}
		return [...visible];
	});

	let bezier_handle_segments = $derived.by((): BezierHandleSegment[] => {
		const visible_anchor_set = new Set(bezier_visible_anchor_key_ids);
		if (visible_anchor_set.size === 0) {
			return [];
		}

		const segments: BezierHandleSegment[] = [];
		for (let index = 0; index + 1 < parsed_keys.length; index += 1) {
			const start = parsed_keys[index];
			const end = parsed_keys[index + 1];
			const segment = resolve_bezier_handle_segment(start, end);
			if (!segment) {
				continue;
			}
			if (
				!visible_anchor_set.has(segment.start_key_id) &&
				!visible_anchor_set.has(segment.end_key_id)
			) {
				continue;
			}
			segments.push(segment);
		}
		return segments;
	});

	const bezier_handle_control_id = (ref: BezierHandleRef): string => `${ref.key_id}:${ref.kind}`;

	let bezier_handle_controls = $derived.by((): BezierHandleControl[] => {
		const visible_anchor_set = new Set(bezier_visible_anchor_key_ids);
		const controls: BezierHandleControl[] = [];
		for (const segment of bezier_handle_segments) {
			if (visible_anchor_set.has(segment.start_key_id)) {
				controls.push({
					ref: { key_id: segment.key_id, kind: 'out' },
					anchor_key_id: segment.start_key_id,
					anchor_position: segment.start_position,
					anchor_value: segment.start_value,
					handle_position: segment.out_curve_position,
					handle_value: segment.out_curve_value,
					coordinate_space: segment.coordinate_space,
					segment_start_position: segment.start_position,
					segment_end_position: segment.end_position,
					span: segment.span,
					params: segment.params
				});
			}
			if (visible_anchor_set.has(segment.end_key_id)) {
				controls.push({
					ref: { key_id: segment.key_id, kind: 'in' },
					anchor_key_id: segment.end_key_id,
					anchor_position: segment.end_position,
					anchor_value: segment.end_value,
					handle_position: segment.in_curve_position,
					handle_value: segment.in_curve_value,
					coordinate_space: segment.coordinate_space,
					segment_start_position: segment.start_position,
					segment_end_position: segment.end_position,
					span: segment.span,
					params: segment.params
				});
			}
		}
		return controls;
	});

	let bezier_handle_control_by_id = $derived.by((): Map<string, BezierHandleControl> => {
		const controls = new Map<string, BezierHandleControl>();
		for (const control of bezier_handle_controls) {
			controls.set(bezier_handle_control_id(control.ref), control);
		}
		return controls;
	});

	let bezier_handle_refs_by_anchor_key_id = $derived.by((): Map<NodeId, BezierHandleRef[]> => {
		const mapping = new Map<NodeId, BezierHandleRef[]>();
		for (const control of bezier_handle_controls) {
			const existing = mapping.get(control.anchor_key_id) ?? [];
			existing.push(control.ref);
			mapping.set(control.anchor_key_id, existing);
		}
		return mapping;
	});

	let bezier_handle_visuals = $derived.by((): BezierHandleVisual[] =>
		bezier_handle_controls.map((control) => ({
			key_id: control.ref.key_id,
			kind: control.ref.kind,
			anchor_position: control.anchor_position,
			anchor_value: control.anchor_value,
			handle_position: control.handle_position,
			handle_value: control.handle_value
		}))
	);
	let editable_curve_range_node = $derived.by((): UiNodeDto | null => {
		const nodes_by_id = graphNodesById;
		if (!nodes_by_id || liveNode.node_type !== CURVE_NODE_TYPE) {
			return null;
		}
		for (const child_id of liveNode.children) {
			const child = nodes_by_id.get(child_id);
			if (!child || child.decl_id !== DECL_RANGE || child.node_type !== RANGE_NODE_TYPE) {
				continue;
			}
			return child;
		}
		return null;
	});
	let curve_range_state = $derived.by((): CurveRangeState | null => {
		const range_node = editable_curve_range_node;
		if (range_node) {
			const nodes_by_id = graphNodesById;
			if (!nodes_by_id) {
				return null;
			}
			let x_bounds: { min: number; max: number } | null = null;
			let y_bounds: { min: number; max: number } | null = null;
			for (const child_id of range_node.children) {
				const child = nodes_by_id.get(child_id);
				if (!child || child.data.kind !== 'parameter') {
					continue;
				}
				if (child.decl_id === DECL_RANGE_X) {
					x_bounds = range_bounds_from_value(child.data.param.value);
					continue;
				}
				if (child.decl_id === DECL_RANGE_Y) {
					y_bounds = range_bounds_from_value(child.data.param.value);
				}
			}

			if (!x_bounds || !y_bounds) {
				return null;
			}
			const bounds = make_curve_range_constraint(
				x_bounds.min,
				x_bounds.max,
				y_bounds.min,
				y_bounds.max
			);
			if (!bounds) {
				return null;
			}
			return {
				bounds,
				active: range_node.meta.enabled,
				range_node
			};
		}

		let x_bounds: { min: number; max: number } | null = null;
		let y_bounds: { min: number; max: number } | null = null;
		for (const key of parsed_keys) {
			if (!x_bounds && key.position_param) {
				x_bounds = uniform_bounds_from_constraints(key.position_param.constraints);
			}
			if (!y_bounds && key.value_param) {
				y_bounds = uniform_bounds_from_constraints(key.value_param.constraints);
			}
			if (x_bounds && y_bounds) {
				break;
			}
		}
		if (!x_bounds || !y_bounds) {
			return null;
		}
		const bounds = make_curve_range_constraint(
			x_bounds.min,
			x_bounds.max,
			y_bounds.min,
			y_bounds.max
		);
		if (!bounds) {
			return null;
		}
		return {
			bounds,
			active: true,
			range_node: null
		};
	});
	let active_curve_range_constraint = $derived.by((): CurveRangeConstraint | null => {
		if (!curve_range_state?.active) {
			return null;
		}
		return curve_range_state.bounds;
	});
	let selected_key = $derived.by((): ParsedCurveKey | null => {
		if (selected_key_id === null) {
			return null;
		}
		return parsed_key_by_id.get(selected_key_id) ?? null;
	});
	let key_creatable_item = $derived.by(
		() =>
			liveNode.creatable_user_items.find(
				(item) => item.node_type === KEY_NODE_TYPE || item.item_kind === KEY_ITEM_KIND
			) ?? null
	);
	let compiled_curve = $derived.by(() => compile_curve(parsed_keys));

	$effect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const refresh = (): void => {
			const parsed = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
			if (Number.isFinite(parsed) && parsed > 0) {
				rem_base_px = parsed;
			}
		};
		refresh();
		window.addEventListener('resize', refresh);
		return () => {
			window.removeEventListener('resize', refresh);
		};
	});

	$effect(() => {
		if (parsed_keys.length === 0) {
			if (selected_key_id !== null) {
				selected_key_id = null;
			}
			if (selected_key_ids.length > 0) {
				selected_key_ids = [];
			}
			return;
		}
		const available_key_ids = new Set(parsed_keys.map((entry) => entry.node_id));
		const filtered_selection = selected_key_ids.filter((key_id) => available_key_ids.has(key_id));
		if (filtered_selection.length === 0) {
			if (selected_key_id !== null && available_key_ids.has(selected_key_id)) {
				const singleton = [selected_key_id];
				if (!same_node_id_array(selected_key_ids, singleton)) {
					selected_key_ids = singleton;
				}
				return;
			}
			if (selected_key_id !== null) {
				selected_key_id = null;
			}
			if (selected_key_ids.length > 0) {
				selected_key_ids = [];
			}
			return;
		}
		if (!same_node_id_array(filtered_selection, selected_key_ids)) {
			selected_key_ids = filtered_selection;
		}
		if (
			(selected_key_id === null || !filtered_selection.includes(selected_key_id)) &&
			selected_key_id !== filtered_selection[0]
		) {
			selected_key_id = filtered_selection[0];
		}
	});

	$effect(() => {
		const pending = pending_create_target;
		if (!pending) {
			return;
		}
		for (const key of parsed_keys) {
			if (pending.known_key_ids.has(key.node_id)) {
				continue;
			}
			set_single_selected_key(key.node_id);
			set_drag_preview(key.node_id, pending.position, pending.value);
			pending_create_target = null;
			void (async () => {
				try {
					await set_numeric_param(key.position_param, pending.position);
					await set_numeric_param(key.value_param, pending.value);
				} finally {
					clear_drag_preview(key.node_id);
					if (pending.edit_session) {
						await pending.edit_session.end();
					}
				}
			})();
			return;
		}
	});

	const canvas_local_point = (
		event: MouseEvent | PointerEvent
	): { x: number; y: number } | null => {
		if (!canvas_element) {
			return null;
		}
		const rect = canvas_element.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
	};

	const blur_active_editable_element = (): void => {
		if (typeof document === 'undefined') {
			return;
		}
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) {
			return;
		}
		if (active.isContentEditable) {
			active.blur();
			return;
		}
		const tag = active.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
			active.blur();
		}
	};

	const screen_to_curve_point = (
		screen_x: number,
		screen_y: number
	): { position: number; value: number } | null => {
		if (!interaction_transform) {
			return null;
		}
		const normalized_x = clamp(
			(screen_x - interaction_transform.plot_left) / interaction_transform.plot_width,
			0,
			1
		);
		const normalized_y = clamp(
			(screen_y - interaction_transform.plot_top) / interaction_transform.plot_height,
			0,
			1
		);
		const curve_point = {
			position:
				interaction_transform.x_min +
				normalized_x * (interaction_transform.x_max - interaction_transform.x_min),
			value:
				interaction_transform.y_max -
				normalized_y * (interaction_transform.y_max - interaction_transform.y_min)
		};
		return clamp_curve_point_to_active_range(curve_point.position, curve_point.value);
	};

	const current_view_bounds = (): CurveViewBounds | null => {
		if (fixed_view_bounds) {
			return { ...fixed_view_bounds };
		}
		if (!interaction_transform) {
			return null;
		}
		return {
			x_min: interaction_transform.x_min,
			x_max: interaction_transform.x_max,
			y_min: interaction_transform.y_min,
			y_max: interaction_transform.y_max
		};
	};

	const sanitize_view_bounds = (bounds: CurveViewBounds): CurveViewBounds | null => {
		if (
			!Number.isFinite(bounds.x_min) ||
			!Number.isFinite(bounds.x_max) ||
			!Number.isFinite(bounds.y_min) ||
			!Number.isFinite(bounds.y_max)
		) {
			return null;
		}

		const active_range = active_curve_range_constraint;
		if (active_range) {
			const range_span_x = active_range.x_max - active_range.x_min;
			const range_span_y = active_range.y_max - active_range.y_min;
			if (range_span_x <= CURVE_EPSILON || range_span_y <= CURVE_EPSILON) {
				return null;
			}

			let x_span = bounds.x_max - bounds.x_min;
			let y_span = bounds.y_max - bounds.y_min;
			if (!Number.isFinite(x_span) || !Number.isFinite(y_span)) {
				return null;
			}

			const min_x_span = Math.min(MIN_VIEW_SPAN, range_span_x);
			const min_y_span = Math.min(MIN_VIEW_SPAN, range_span_y);
			x_span = clamp(x_span, min_x_span, range_span_x);
			y_span = clamp(y_span, min_y_span, range_span_y);
			if (x_span > MAX_VIEW_SPAN || y_span > MAX_VIEW_SPAN) {
				return null;
			}

			const center_x_candidate = (bounds.x_min + bounds.x_max) * 0.5;
			const center_y_candidate = (bounds.y_min + bounds.y_max) * 0.5;
			const min_center_x = active_range.x_min + x_span * 0.5;
			const max_center_x = active_range.x_max - x_span * 0.5;
			const min_center_y = active_range.y_min + y_span * 0.5;
			const max_center_y = active_range.y_max - y_span * 0.5;

			const center_x =
				min_center_x > max_center_x
					? (active_range.x_min + active_range.x_max) * 0.5
					: clamp(center_x_candidate, min_center_x, max_center_x);
			const center_y =
				min_center_y > max_center_y
					? (active_range.y_min + active_range.y_max) * 0.5
					: clamp(center_y_candidate, min_center_y, max_center_y);

			return {
				x_min: center_x - x_span * 0.5,
				x_max: center_x + x_span * 0.5,
				y_min: center_y - y_span * 0.5,
				y_max: center_y + y_span * 0.5
			};
		}

		let x_span = bounds.x_max - bounds.x_min;
		let y_span = bounds.y_max - bounds.y_min;
		if (x_span < MIN_VIEW_SPAN) {
			const center = (bounds.x_min + bounds.x_max) * 0.5;
			x_span = MIN_VIEW_SPAN;
			bounds.x_min = center - x_span * 0.5;
			bounds.x_max = center + x_span * 0.5;
		}
		if (y_span < MIN_VIEW_SPAN) {
			const center = (bounds.y_min + bounds.y_max) * 0.5;
			y_span = MIN_VIEW_SPAN;
			bounds.y_min = center - y_span * 0.5;
			bounds.y_max = center + y_span * 0.5;
		}
		if (x_span > MAX_VIEW_SPAN || y_span > MAX_VIEW_SPAN) {
			return null;
		}

		return bounds;
	};

	const apply_view_bounds = (candidate: CurveViewBounds): void => {
		const sanitized = sanitize_view_bounds({ ...candidate });
		if (!sanitized) {
			return;
		}
		curve_view_mode = 'fixed';
		fixed_view_bounds = sanitized;
	};

	$effect(() => {
		active_curve_range_constraint;
		const current_fixed = fixed_view_bounds;
		if (!current_fixed) {
			return;
		}
		const sanitized = sanitize_view_bounds({ ...current_fixed });
		if (!sanitized) {
			fixed_view_bounds = null;
			return;
		}
		if (
			Math.abs(current_fixed.x_min - sanitized.x_min) > CURVE_EPSILON ||
			Math.abs(current_fixed.x_max - sanitized.x_max) > CURVE_EPSILON ||
			Math.abs(current_fixed.y_min - sanitized.y_min) > CURVE_EPSILON ||
			Math.abs(current_fixed.y_max - sanitized.y_max) > CURVE_EPSILON
		) {
			fixed_view_bounds = sanitized;
		}
	});

	const pan_view_by_pixels = (delta_screen_x: number, delta_screen_y: number): void => {
		const base = current_view_bounds();
		if (!base || !interaction_transform) {
			return;
		}
		const units_per_px_x =
			(base.x_max - base.x_min) / Math.max(1, interaction_transform.plot_width);
		const units_per_px_y =
			(base.y_max - base.y_min) / Math.max(1, interaction_transform.plot_height);
		apply_view_bounds({
			x_min: base.x_min - delta_screen_x * units_per_px_x,
			x_max: base.x_max - delta_screen_x * units_per_px_x,
			y_min: base.y_min + delta_screen_y * units_per_px_y,
			y_max: base.y_max + delta_screen_y * units_per_px_y
		});
	};

	const zoom_view_at_screen = (
		screen_x: number,
		screen_y: number,
		zoom_factor_x: number,
		zoom_factor_y: number
	): void => {
		if (!interaction_transform) {
			return;
		}
		const anchor = screen_to_curve_point(screen_x, screen_y);
		const base = current_view_bounds();
		if (!anchor || !base) {
			return;
		}

		const safe_zoom_x = clamp(zoom_factor_x, 0.08, 24);
		const safe_zoom_y = clamp(zoom_factor_y, 0.08, 24);
		const left = anchor.position - base.x_min;
		const right = base.x_max - anchor.position;
		const down = anchor.value - base.y_min;
		const up = base.y_max - anchor.value;

		apply_view_bounds({
			x_min: anchor.position - left * safe_zoom_x,
			x_max: anchor.position + right * safe_zoom_x,
			y_min: anchor.value - down * safe_zoom_y,
			y_max: anchor.value + up * safe_zoom_y
		});
	};

	const normalize_wheel_delta = (event: WheelEvent): { x: number; y: number } => {
		let scale = 1;
		if (event.deltaMode === 1) {
			scale = rem_base_px * 1.3;
		} else if (event.deltaMode === 2) {
			const rect = canvas_element?.getBoundingClientRect();
			const width = rect ? Math.max(1, rect.width) : 1;
			const height = rect ? Math.max(1, rect.height) : 1;
			scale = Math.max(width, height);
		}
		return {
			x: event.deltaX * scale,
			y: event.deltaY * scale
		};
	};

	const nearest_key = (screen_x: number, screen_y: number, threshold_px: number): NodeId | null => {
		if (!interaction_transform) {
			return null;
		}
		let result: NodeId | null = null;
		let best_distance = Number.POSITIVE_INFINITY;
		for (const [key_id, point] of interaction_transform.key_screen_points.entries()) {
			const dx = point.x - screen_x;
			const dy = point.y - screen_y;
			const distance = Math.hypot(dx, dy);
			if (distance > threshold_px || distance >= best_distance) {
				continue;
			}
			best_distance = distance;
			result = key_id;
		}
		return result;
	};

	const nearest_curve_owner_key = (
		screen_x: number,
		screen_y: number,
		threshold_px: number
	): NodeId | null => {
		if (!interaction_transform) {
			return null;
		}
		const curve_x = interaction_transform.curve_screen_x;
		const curve_y = interaction_transform.curve_screen_y;
		const owners = interaction_transform.curve_owner_key_ids;
		if (curve_x.length < 2 || curve_y.length < 2) {
			return null;
		}

		let result: NodeId | null = null;
		let best_distance_sq = threshold_px * threshold_px;
		for (let index = 0; index + 1 < curve_x.length; index += 1) {
			const owner = owners[index] ?? owners[index + 1];
			if (owner === null) {
				continue;
			}

			const ax = curve_x[index];
			const ay = curve_y[index];
			const bx = curve_x[index + 1];
			const by = curve_y[index + 1];
			const dx = bx - ax;
			const dy = by - ay;
			const length_sq = dx * dx + dy * dy;
			let t = 0;
			if (length_sq > CURVE_EPSILON) {
				t = clamp(((screen_x - ax) * dx + (screen_y - ay) * dy) / length_sq, 0, 1);
			}
			const closest_x = ax + dx * t;
			const closest_y = ay + dy * t;
			const distance_sq =
				(closest_x - screen_x) * (closest_x - screen_x) +
				(closest_y - screen_y) * (closest_y - screen_y);
			if (distance_sq >= best_distance_sq) {
				continue;
			}
			best_distance_sq = distance_sq;
			result = owner;
		}
		return result;
	};

	const nearest_bezier_handle = (
		screen_x: number,
		screen_y: number,
		threshold_px: number
	): BezierHandleRef | null => {
		if (!interaction_transform || bezier_handle_controls.length === 0) {
			return null;
		}

		const transform = interaction_transform;
		const x_span = Math.max(CURVE_EPSILON, transform.x_max - transform.x_min);
		const y_span = Math.max(CURVE_EPSILON, transform.y_max - transform.y_min);
		const to_screen_x = (position: number): number =>
			transform.plot_left + ((position - transform.x_min) / x_span) * transform.plot_width;
		const to_screen_y = (value: number): number =>
			transform.plot_top +
			transform.plot_height -
			((value - transform.y_min) / y_span) * transform.plot_height;

		let nearest: BezierHandleRef | null = null;
		let best_distance = Number.POSITIVE_INFINITY;
		const consider = (ref: BezierHandleRef, position: number, value: number): void => {
			const x = to_screen_x(position);
			const y = to_screen_y(value);
			const distance = Math.hypot(x - screen_x, y - screen_y);
			if (distance > threshold_px || distance >= best_distance) {
				return;
			}
			best_distance = distance;
			nearest = ref;
		};

		for (const control of bezier_handle_controls) {
			consider(control.ref, control.handle_position, control.handle_value);
		}
		return nearest;
	};

	const bezier_preview_from_control = (control: BezierHandleControl): BezierEasingPreview => {
		const params = control.params;
		return {
			out_position: param_number_value(params[DECL_OUT_POSITION]?.value, 1 / 3),
			out_value: param_number_value(params[DECL_OUT_VALUE]?.value, 1 / 3),
			in_position: param_number_value(params[DECL_IN_POSITION]?.value, -1 / 3),
			in_value: param_number_value(params[DECL_IN_VALUE]?.value, -1 / 3)
		};
	};

	const bezier_preview_handle_curve_x = (
		control: BezierHandleControl,
		preview: BezierEasingPreview,
		kind: BezierHandleKind
	): number => {
		const raw =
			kind === 'out'
				? control.coordinate_space === 'relative'
					? control.segment_start_position + preview.out_position * control.span
					: preview.out_position
				: control.coordinate_space === 'relative'
					? control.segment_end_position + preview.in_position * control.span
					: preview.in_position;
		return clamp(raw, control.segment_start_position, control.segment_end_position);
	};

	const clamp_bezier_handle_x = (
		control: BezierHandleControl,
		preview: BezierEasingPreview,
		kind: BezierHandleKind,
		position: number
	): number => {
		let clamped = clamp(position, control.segment_start_position, control.segment_end_position);
		const out_x = bezier_preview_handle_curve_x(control, preview, 'out');
		const in_x = bezier_preview_handle_curve_x(control, preview, 'in');
		if (kind === 'out') {
			clamped = Math.min(clamped, in_x);
		} else {
			clamped = Math.max(clamped, out_x);
		}
		return clamped;
	};

	const with_bezier_preview_handle = (
		control: BezierHandleControl,
		preview: BezierEasingPreview,
		kind: BezierHandleKind,
		handle_position: number,
		handle_value: number
	): BezierEasingPreview => {
		const span = Math.max(CURVE_EPSILON, control.span);
		const next = { ...preview };
		if (kind === 'out') {
			next.out_position =
				control.coordinate_space === 'relative'
					? (handle_position - control.segment_start_position) / span
					: handle_position;
			next.out_value = handle_value - control.anchor_value;
			return next;
		}
		next.in_position =
			control.coordinate_space === 'relative'
				? (handle_position - control.segment_end_position) / span
				: handle_position;
		next.in_value = handle_value - control.anchor_value;
		return next;
	};

	const flush_queued_drag = (): void => {
		if (!queued_drag_targets || queued_drag_targets.size === 0) {
			return;
		}
		for (const [key_id, target] of queued_drag_targets.entries()) {
			const key = parsed_key_by_id.get(key_id);
			if (!key) {
				continue;
			}
			void set_numeric_param(key.position_param, target.position);
			void set_numeric_param(key.value_param, target.value);
		}
		queued_drag_targets = null;
	};

	const bezier_param_refs_by_key_id = (key_id: NodeId): Record<string, ParamNodeRef> | null => {
		const nodes_by_id = graphNodesById;
		if (!nodes_by_id) {
			return null;
		}
		const key_node = nodes_by_id.get(key_id);
		if (!key_node || key_node.node_type !== KEY_NODE_TYPE) {
			return null;
		}
		for (const key_child_id of key_node.children) {
			const key_child = nodes_by_id.get(key_child_id);
			if (!key_child || key_child.decl_id !== DECL_EASING || key_child.node_type !== EASING_NODE_TYPE) {
				continue;
			}
			const easing_params: Record<string, ParamNodeRef> = {};
			for (const easing_child_id of key_child.children) {
				const easing_child = nodes_by_id.get(easing_child_id);
				const param_ref = to_param_ref(easing_child);
				if (!easing_child || !param_ref) {
					continue;
				}
				easing_params[easing_child.decl_id] = param_ref;
			}
			const easing_kind = normalize_easing_kind(
				param_string_value(easing_params[DECL_KIND]?.value, 'linear')
			);
			if (easing_kind !== 'bezier') {
				return null;
			}
			return easing_params;
		}
		return null;
	};

	const flush_queued_bezier_handle = (): void => {
		if (!queued_bezier_handle_targets || queued_bezier_handle_targets.size === 0) {
			return;
		}
		const targets = queued_bezier_handle_targets;
		queued_bezier_handle_targets = null;

		const send_if_changed = (ref: ParamNodeRef | undefined, value: number): void => {
			if (!ref || !Number.isFinite(value)) {
				return;
			}
			const current = param_number_value(ref.value, value);
			if (Math.abs(current - value) <= 1e-9) {
				return;
			}
			void set_numeric_param(ref, value);
		};

		for (const [key_id, preview] of targets.entries()) {
			const easing_params = bezier_param_refs_by_key_id(key_id);
			if (!easing_params) {
				continue;
			}
			send_if_changed(easing_params[DECL_OUT_POSITION], preview.out_position);
			send_if_changed(easing_params[DECL_OUT_VALUE], preview.out_value);
			send_if_changed(easing_params[DECL_IN_POSITION], preview.in_position);
			send_if_changed(easing_params[DECL_IN_VALUE], preview.in_value);
		}
	};

	const ensure_drag_commit_frame = (): void => {
		if (drag_commit_raf_id !== 0 || typeof window === 'undefined') {
			return;
		}
		drag_commit_raf_id = window.requestAnimationFrame(() => {
			drag_commit_raf_id = 0;
			flush_queued_drag();
			flush_queued_bezier_handle();
		});
	};

	const queue_drag_commit = (targets: Map<NodeId, DragPreview>): void => {
		queued_drag_targets = targets;
		ensure_drag_commit_frame();
	};

	const queue_bezier_handle_commit = (targets: Map<NodeId, BezierEasingPreview>): void => {
		queued_bezier_handle_targets = targets;
		ensure_drag_commit_frame();
	};

	const begin_drag_edit_session = (label: string, prefix: string): void => {
		const edit_session = createUiEditSession(label, prefix);
		drag_edit_session = edit_session;
		drag_edit_session_begin_promise = edit_session.begin();
	};

	const finish_drag = (pointer_id?: number): void => {
		let did_finish = false;
		if (active_drag && (pointer_id === undefined || active_drag.pointer_id === pointer_id)) {
			flush_queued_drag();
			for (const entry of active_drag.origins) {
				clear_drag_preview(entry.key_id);
			}
			const release_pointer_id = pointer_id ?? active_drag.pointer_id;
			if (canvas_element && canvas_element.hasPointerCapture(release_pointer_id)) {
				canvas_element.releasePointerCapture(release_pointer_id);
			}
			active_drag = null;
			did_finish = true;
		}
		if (
			active_bezier_handle_drag &&
			(pointer_id === undefined || active_bezier_handle_drag.pointer_id === pointer_id)
		) {
			flush_queued_bezier_handle();
			for (const key_id of active_bezier_handle_drag.touched_key_ids) {
				clear_easing_drag_preview(key_id);
			}
			hover_bezier_handle = null;
			const release_pointer_id = pointer_id ?? active_bezier_handle_drag.pointer_id;
			if (canvas_element && canvas_element.hasPointerCapture(release_pointer_id)) {
				canvas_element.releasePointerCapture(release_pointer_id);
			}
			active_bezier_handle_drag = null;
			did_finish = true;
		}
		if (did_finish && drag_edit_session) {
			const edit_session = drag_edit_session;
			const begin_promise = drag_edit_session_begin_promise;
			drag_edit_session = null;
			drag_edit_session_begin_promise = null;
			void (async () => {
				if (begin_promise) {
					await begin_promise;
				}
				if (pending_param_write_promises.size > 0) {
					await Promise.allSettled([...pending_param_write_promises]);
				}
				await edit_session.end();
			})();
		}
	};

	const finish_canvas_pan = (pointer_id?: number): void => {
		if (!active_canvas_pan) {
			return;
		}
		if (pointer_id !== undefined && active_canvas_pan.pointer_id !== pointer_id) {
			return;
		}
		const release_pointer_id = pointer_id ?? active_canvas_pan.pointer_id;
		if (canvas_element && canvas_element.hasPointerCapture(release_pointer_id)) {
			canvas_element.releasePointerCapture(release_pointer_id);
		}
		active_canvas_pan = null;
	};

	const update_bezier_handle_drag_preview = (
		drag: ActiveBezierHandleDrag,
		curve_point: { position: number; value: number },
		individual_mode: boolean
	): Map<NodeId, BezierEasingPreview> => {
		const targets = new Map<NodeId, BezierEasingPreview>();
		const control = bezier_handle_control_by_id.get(bezier_handle_control_id(drag.ref));
		if (!control) {
			return targets;
		}

		const active_base_preview = bezier_preview_from_control(control);
		const dragged_x = clamp_bezier_handle_x(
			control,
			active_base_preview,
			drag.ref.kind,
			curve_point.position
		);
		const active_preview = with_bezier_preview_handle(
			control,
			active_base_preview,
			drag.ref.kind,
			dragged_x,
			curve_point.value
		);
		targets.set(control.ref.key_id, active_preview);

		if (individual_mode || !drag.opposite_ref || drag.opposite_length <= CURVE_EPSILON) {
			return targets;
		}

		const opposite = bezier_handle_control_by_id.get(bezier_handle_control_id(drag.opposite_ref));
		if (!opposite) {
			return targets;
		}

		const vector_x = dragged_x - control.anchor_position;
		const vector_y = curve_point.value - control.anchor_value;
		const vector_length = Math.hypot(vector_x, vector_y);
		if (vector_length <= CURVE_EPSILON) {
			return targets;
		}

		const opposite_base_preview = bezier_preview_from_control(opposite);
		const opposite_direction_x = -vector_x / vector_length;
		const opposite_direction_y = -vector_y / vector_length;
		const projected_opposite_x = opposite.anchor_position + opposite_direction_x * drag.opposite_length;
		const projected_opposite_y = opposite.anchor_value + opposite_direction_y * drag.opposite_length;
		const opposite_x = clamp_bezier_handle_x(
			opposite,
			opposite_base_preview,
			opposite.ref.kind,
			projected_opposite_x
		);
		const opposite_preview = with_bezier_preview_handle(
			opposite,
			opposite_base_preview,
			opposite.ref.kind,
			opposite_x,
			projected_opposite_y
		);
		targets.set(opposite.ref.key_id, opposite_preview);
		return targets;
	};

	const on_canvas_pointer_down = (event: PointerEvent): void => {
		if (!interaction_transform || !canvas_element) {
			return;
		}
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}
		blur_active_editable_element();
		hover_curve_position = screen_to_curve_point(point.x, point.y);

		if (event.button === 1) {
			const start_bounds = current_view_bounds();
			if (!start_bounds) {
				return;
			}
			hover_key_id = null;
			active_canvas_pan = {
				pointer_id: event.pointerId,
				start_screen_x: point.x,
				start_screen_y: point.y,
				start_bounds
			};
			apply_view_bounds(start_bounds);
			canvas_element.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}
		if (event.button !== 0) {
			return;
		}

		const bezier_handle = nearest_bezier_handle(point.x, point.y, Math.max(7, rem_base_px * 0.58));
		if (bezier_handle) {
			const control = bezier_handle_control_by_id.get(bezier_handle_control_id(bezier_handle));
			if (!control) {
				return;
			}
			hover_bezier_handle = bezier_handle;
			hover_key_id = control.anchor_key_id;

			const opposite_candidates = bezier_handle_refs_by_anchor_key_id.get(control.anchor_key_id) ?? [];
			let opposite_ref: BezierHandleRef | null = null;
			for (const candidate of opposite_candidates) {
				if (bezier_handle_control_id(candidate) === bezier_handle_control_id(bezier_handle)) {
					continue;
				}
				opposite_ref = candidate;
				break;
			}

			let opposite_length = 0;
			if (opposite_ref) {
				const opposite_control = bezier_handle_control_by_id.get(
					bezier_handle_control_id(opposite_ref)
				);
				if (opposite_control) {
					const opposite_dx = opposite_control.handle_position - opposite_control.anchor_position;
					const opposite_dy = opposite_control.handle_value - opposite_control.anchor_value;
					opposite_length = Math.hypot(opposite_dx, opposite_dy);
				}
			}

			begin_drag_edit_session('Adjust Curve Bezier Handle', 'curve-bezier-drag');
			active_bezier_handle_drag = {
				pointer_id: event.pointerId,
				ref: bezier_handle,
				opposite_ref,
				opposite_length,
				touched_key_ids: new Set<NodeId>([bezier_handle.key_id])
			};
			canvas_element.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}

		const additive_selection = event.shiftKey;
		const toggle_selection = event.ctrlKey || event.metaKey;
		const selection = nearest_key(point.x, point.y, Math.max(6, rem_base_px * 0.62));
		if (selection !== null) {
			if (toggle_selection) {
				toggle_selected_key(selection);
				event.preventDefault();
				return;
			}
			if (additive_selection) {
				add_selected_key(selection);
				selected_key_id = selection;
				event.preventDefault();
				return;
			}

			if (!has_selected_key(selection)) {
				set_single_selected_key(selection);
			} else {
				selected_key_id = selection;
			}

			const drag_key_ids = has_selected_key(selection) ? selected_key_ids : [selection];
			const drag_origins: Array<{ key_id: NodeId; position: number; value: number }> = [];
			for (const key_id of drag_key_ids) {
				const key = parsed_key_by_id.get(key_id);
				if (!key?.position_param || !key.value_param) {
					continue;
				}
				drag_origins.push({
					key_id,
					position: key.position,
					value: key.value
				});
			}
			const anchor_origin =
				drag_origins.find((entry) => entry.key_id === selection) ?? drag_origins[0] ?? null;
			if (!anchor_origin) {
				return;
			}

			begin_drag_edit_session('Move Curve Key', 'curve-key-drag');
			active_drag = {
				pointer_id: event.pointerId,
				anchor_key_id: anchor_origin.key_id,
				anchor_start_position: anchor_origin.position,
				anchor_start_value: anchor_origin.value,
				origins: drag_origins
			};
			canvas_element.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}

		const curve_selection = nearest_curve_owner_key(
			point.x,
			point.y,
			Math.max(4, rem_base_px * 0.45)
		);
		if (curve_selection !== null) {
			if (toggle_selection) {
				toggle_selected_key(curve_selection);
				return;
			}
			if (additive_selection) {
				add_selected_key(curve_selection);
				selected_key_id = curve_selection;
				return;
			}
			set_single_selected_key(curve_selection);
			return;
		}

		if (!toggle_selection && !additive_selection) {
			set_single_selected_key(null);
		}
	};

	const on_canvas_pointer_move = (event: PointerEvent): void => {
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}
		hover_curve_position = screen_to_curve_point(point.x, point.y);

		if (
			active_canvas_pan &&
			active_canvas_pan.pointer_id === event.pointerId &&
			interaction_transform
		) {
			hover_key_id = null;
			hover_bezier_handle = null;
			const delta_x = point.x - active_canvas_pan.start_screen_x;
			const delta_y = point.y - active_canvas_pan.start_screen_y;
			const start = active_canvas_pan.start_bounds;
			const units_per_px_x =
				(start.x_max - start.x_min) / Math.max(1, interaction_transform.plot_width);
			const units_per_px_y =
				(start.y_max - start.y_min) / Math.max(1, interaction_transform.plot_height);
			apply_view_bounds({
				x_min: start.x_min - delta_x * units_per_px_x,
				x_max: start.x_max - delta_x * units_per_px_x,
				y_min: start.y_min + delta_y * units_per_px_y,
				y_max: start.y_max + delta_y * units_per_px_y
			});
			return;
		}

		if (active_bezier_handle_drag && active_bezier_handle_drag.pointer_id === event.pointerId) {
			const curve_point = screen_to_curve_point(point.x, point.y);
			if (!curve_point) {
				return;
			}
			const preview_updates = update_bezier_handle_drag_preview(
				active_bezier_handle_drag,
				curve_point,
				event.altKey
			);
			if (preview_updates.size === 0) {
				return;
			}
			for (const [key_id, preview] of preview_updates.entries()) {
				set_easing_drag_preview(key_id, preview);
				active_bezier_handle_drag.touched_key_ids.add(key_id);
			}
			queue_bezier_handle_commit(preview_updates);
			hover_bezier_handle = active_bezier_handle_drag.ref;
			const active_control = bezier_handle_control_by_id.get(
				bezier_handle_control_id(active_bezier_handle_drag.ref)
			);
			if (active_control) {
				hover_key_id = active_control.anchor_key_id;
			}
			return;
		}

		if (active_drag && active_drag.pointer_id === event.pointerId) {
			const curve_point = screen_to_curve_point(point.x, point.y);
			if (!curve_point) {
				return;
			}
			hover_bezier_handle = null;
			const delta_position = curve_point.position - active_drag.anchor_start_position;
			const delta_value = curve_point.value - active_drag.anchor_start_value;
			const commit_targets = new Map<NodeId, DragPreview>();
			for (const origin of active_drag.origins) {
				const translated = clamp_curve_point_to_active_range(
					origin.position + delta_position,
					origin.value + delta_value
				);
				set_drag_preview(origin.key_id, translated.position, translated.value);
				commit_targets.set(origin.key_id, translated);
			}
			queue_drag_commit(commit_targets);
			return;
		}

		const hovered_bezier_handle = nearest_bezier_handle(
			point.x,
			point.y,
			Math.max(7, rem_base_px * 0.5)
		);
		hover_bezier_handle = hovered_bezier_handle;
		if (hovered_bezier_handle) {
			const hovered_control = bezier_handle_control_by_id.get(
				bezier_handle_control_id(hovered_bezier_handle)
			);
			hover_key_id = hovered_control?.anchor_key_id ?? hovered_bezier_handle.key_id;
			return;
		}

		const hovered_key = nearest_key(point.x, point.y, Math.max(6, rem_base_px * 0.56));
		if (hovered_key !== null) {
			hover_key_id = hovered_key;
			return;
		}
		hover_key_id = nearest_curve_owner_key(point.x, point.y, Math.max(4, rem_base_px * 0.42));
	};

	const on_canvas_pointer_up = (event: PointerEvent): void => {
		finish_drag(event.pointerId);
		finish_canvas_pan(event.pointerId);
	};
	const on_canvas_pointer_cancel = (event: PointerEvent): void => {
		finish_drag(event.pointerId);
		finish_canvas_pan(event.pointerId);
	};
	const on_canvas_pointer_leave = (): void => {
		hover_key_id = null;
		hover_bezier_handle = null;
		hover_curve_position = null;
	};

	const on_canvas_wheel = (event: WheelEvent): void => {
		if (!interaction_transform) {
			return;
		}
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}

		const delta = normalize_wheel_delta(event);
		const should_pan =
			event.shiftKey || event.altKey || Math.abs(delta.x) > Math.abs(delta.y) * 0.65;
		if (should_pan) {
			let pan_x = delta.x;
			let pan_y = delta.y;
			if (event.shiftKey) {
				if (Math.abs(pan_x) < Math.abs(delta.y)) {
					pan_x += delta.y;
				}
				pan_y = 0;
			}
			if (event.altKey) {
				pan_x = 0;
			}
			pan_view_by_pixels(pan_x, pan_y);
			event.preventDefault();
			return;
		}

		const zoom_sensitivity = event.ctrlKey || event.metaKey ? 0.00135 : 0.0023;
		const zoom_factor = Math.exp(delta.y * zoom_sensitivity);
		zoom_view_at_screen(point.x, point.y, zoom_factor, zoom_factor);
		event.preventDefault();
	};

	const add_key_at = async (position: number, value: number): Promise<void> => {
		if (!key_creatable_item || adding_key) {
			return;
		}
		const clamped = clamp_curve_point_to_active_range(position, value);
		const edit_session = createUiEditSession('Add Curve Key', 'curve-key-add');
		await edit_session.begin();
		adding_key = true;
		pending_create_target = {
			known_key_ids: new Set(parsed_keys.map((entry) => entry.node_id)),
			position: clamped.position,
			value: clamped.value,
			edit_session
		};
		const created = await sendCreateUserItemIntent(liveNode.node_id, key_creatable_item);
		adding_key = false;
		if (!created) {
			pending_create_target = null;
			await edit_session.end();
		}
	};

	const on_canvas_double_click = (event: MouseEvent): void => {
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}
		const curve_point = screen_to_curve_point(point.x, point.y);
		if (!curve_point) {
			return;
		}
		void add_key_at(curve_point.position, curve_point.value);
	};

	const remove_selected_key = async (): Promise<void> => {
		if (!selected_key) {
			return;
		}
		const index = parsed_keys.findIndex((entry) => entry.node_id === selected_key.node_id);
		const next_fallback = parsed_keys[index + 1] ?? parsed_keys[index - 1] ?? null;
		const ok = await sendRemoveNodeIntent(selected_key.node_id);
		if (!ok) {
			return;
		}
		const remaining_selection = selected_key_ids.filter(
			(key_id) => key_id !== selected_key.node_id
		);
		if (remaining_selection.length > 0) {
			selected_key_ids = remaining_selection;
			selected_key_id = remaining_selection[0];
			return;
		}
		set_single_selected_key(next_fallback?.node_id ?? null);
	};

	const set_curve_view_mode = (mode: CurveViewMode): void => {
		if (curve_view_mode === mode && mode === 'fixed' && fixed_view_bounds) {
			return;
		}
		curve_view_mode = mode;
		fixed_view_bounds = null;
	};

	const axis_midpoint = (): { position: number; value: number } => {
		if (!interaction_transform) {
			if (active_curve_range_constraint) {
				return {
					position:
						(active_curve_range_constraint.x_min + active_curve_range_constraint.x_max) * 0.5,
					value: (active_curve_range_constraint.y_min + active_curve_range_constraint.y_max) * 0.5
				};
			}
			return { position: 0, value: 0 };
		}
		return {
			position: (interaction_transform.x_min + interaction_transform.x_max) * 0.5,
			value: (interaction_transform.y_min + interaction_transform.y_max) * 0.5
		};
	};

	$effect(() => {
		return () => {
			if (drag_commit_raf_id !== 0 && typeof window !== 'undefined') {
				window.cancelAnimationFrame(drag_commit_raf_id);
				drag_commit_raf_id = 0;
			}
			finish_drag();
			finish_canvas_pan();
			const pending = pending_create_target;
			pending_create_target = null;
			if (pending?.edit_session) {
				void pending.edit_session.end();
			}
		};
	});
</script>

{#if liveNode.node_type === CURVE_NODE_TYPE}
	<div class="animation-curve-node-editor">
		{#if showToolbar}
			<section class="curve-top-toolbar">
				<button
					type="button"
					class="toolbar-button"
					disabled={!key_creatable_item || adding_key}
					onclick={() => {
						const midpoint = axis_midpoint();
						void add_key_at(midpoint.position, midpoint.value);
					}}>
					{adding_key ? 'Adding...' : 'Add Key'}
				</button>
				<button
					type="button"
					class="toolbar-button destructive"
					disabled={!selected_key}
					onclick={() => {
						void remove_selected_key();
					}}>
					Delete Key
				</button>
				<div class="view-mode-toggle" role="group" aria-label="Curve viewport mode">
					<button
						type="button"
						class="toolbar-button mode-button {curve_view_mode === 'adaptive' ? 'active' : ''}"
						onclick={() => {
							set_curve_view_mode('adaptive');
						}}>
						Adaptive
					</button>
					<button
						type="button"
						class="toolbar-button mode-button {curve_view_mode === 'fixed' ? 'active' : ''}"
						onclick={() => {
							set_curve_view_mode('fixed');
						}}>
						Fixed
					</button>
				</div>
				<button
					type="button"
					class="toolbar-button"
					onclick={() => {
						set_curve_view_mode('adaptive');
					}}>
					Fit View
				</button>
				<div class="curve-stats">
					<div><strong>{parsed_keys.length}</strong> keys</div>
					<div><strong>{compiled_curve.segments.length}</strong> segments</div>
				</div>
			</section>
		{/if}
		{#if showHints}
			<div class="curve-nav-hint">
				Wheel: zoom | Shift + wheel: horizontal pan | Alt + wheel: vertical pan | Middle drag: pan |
				Shift + click: add key | Ctrl/Cmd + click: toggle key | Drag selected keys: move | Drag
				bezier handles: ease
			</div>
		{/if}

		<div class="curve-canvas-shell" style:height={canvasHeight}>
			<AnimationCurveCanvas
				compiledCurve={compiled_curve}
				parsedKeys={parsed_keys}
				selectedKeyId={selected_key_id}
				selectedKeyIds={selected_key_ids}
				hoverKeyId={hover_key_id}
				bezierHandles={bezier_handle_visuals}
				activeBezierHandle={active_bezier_handle_drag ? active_bezier_handle_drag.ref : null}
				hoverBezierHandle={hover_bezier_handle}
				hoverCurvePosition={hover_curve_position}
				activeCurveRangeConstraint={active_curve_range_constraint}
				curveViewMode={curve_view_mode}
				bind:fixedViewBounds={fixed_view_bounds}
				bind:interactionTransform={interaction_transform}
				bind:canvasElement={canvas_element}
				activeCanvasPan={active_canvas_pan !== null}
				{showGrid}
				{showNumbers}
				{showBounds}
				canvasHeight="100%"
				sampleCurveAt={(position) => sample_compiled_curve(compiled_curve, position)}
				onpointerdown={on_canvas_pointer_down}
				onpointermove={on_canvas_pointer_move}
				onpointerup={on_canvas_pointer_up}
				onpointercancel={on_canvas_pointer_cancel}
				onpointerleave={on_canvas_pointer_leave}
				onwheel={on_canvas_wheel}
				ondblclick={on_canvas_double_click} />
		</div>
	</div>
{/if}

<style>
	.animation-curve-node-editor {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 0;
	}

	.curve-top-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.33rem;
	}

	.toolbar-button {
		height: 1.45rem;
		padding: 0 0.55rem;
		border-radius: 0.28rem;
		border: solid 0.06rem rgba(207, 228, 255, 0.22);
		background: rgba(194, 220, 255, 0.08);
		color: var(--text-color);
		font-size: 0.66rem;
	}

	.toolbar-button.destructive {
		border-color: rgba(255, 127, 127, 0.35);
		background: rgba(255, 97, 97, 0.12);
	}

	.toolbar-button:disabled {
		opacity: 0.45;
	}

	.curve-stats {
		margin-left: auto;
		display: inline-flex;
		gap: 0.45rem;
		font-size: 0.63rem;
		opacity: 0.8;
	}

	.curve-nav-hint {
		font-size: 0.59rem;
		opacity: 0.64;
		padding: 0 0.12rem;
		letter-spacing: 0.01em;
	}

	.view-mode-toggle {
		display: inline-flex;
		align-items: center;
		border-radius: 0.32rem;
		overflow: hidden;
		border: solid 0.06rem rgba(189, 215, 247, 0.28);
	}

	.mode-button {
		border-radius: 0;
		border: none;
		border-right: solid 0.06rem rgba(189, 215, 247, 0.18);
		height: 1.5rem;
		min-width: 4.8rem;
	}

	.mode-button:last-child {
		border-right: none;
	}

	.mode-button.active {
		background: rgba(127, 230, 201, 0.24);
	}

	.curve-canvas-shell {
		height: min(26rem, 38vh);
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
</style>
