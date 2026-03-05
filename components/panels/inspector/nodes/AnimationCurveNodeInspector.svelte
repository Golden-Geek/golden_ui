<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import {
		createUiEditSession,
		sendCreateUserItemIntent,
		sendRemoveNodeIntent,
		sendSetParamIntent,
		type UiEditSession
	} from '$lib/golden_ui/store/ui-intents';
	import type { NodeId, ParamValue, UiNodeDto } from '$lib/golden_ui/types';
	import type { NodeInspectorComponentProps } from '../node-inspector-registry';
	import NodeInspector from '../NodeInspector.svelte';
	import SelectNodeButton from '../../../common/SelectNodeButton.svelte';

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

	interface PendingCreateTarget {
		known_key_ids: Set<NodeId>;
		position: number;
		value: number;
	}

	interface ActiveKeyDrag {
		key_id: NodeId;
		pointer_id: number;
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

	interface GridBlendStep {
		step: number;
		weight: number;
	}

	let { node, level, defaultHeader }: NodeInspectorComponentProps = $props();

	const CURVE_NODE_TYPE = 'animation_curve';
	const KEY_NODE_TYPE = 'animation_curve_key';
	const KEY_ITEM_KIND = 'animation_curve_key';
	const EASING_NODE_TYPE = 'animation_curve_easing';

	const DECL_POSITION = 'position';
	const DECL_VALUE = 'value';
	const DECL_EASING = 'easing';
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
	const GRID_MANTISSAS = [1, 2, 5] as const;
	const GRID_MAX_LINES = 4000;
	const GRID_MIN_PIXEL_SPACING = 3.5;

	let session = $derived(appState.session);
	let graphNodesById = $derived(session?.graph.state.nodesById ?? null);
	let liveNode: UiNodeDto = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);

	let rem_base_px = $state(16);
	let selected_key_id = $state<NodeId | null>(null);
	let hover_key_id = $state<NodeId | null>(null);
	let drag_preview_by_key_id = $state<Map<NodeId, DragPreview>>(new Map());
	let pending_create_target = $state<PendingCreateTarget | null>(null);
	let adding_key = $state(false);
	let curve_view_mode = $state<CurveViewMode>('adaptive');
	let fixed_view_bounds = $state<CurveViewBounds | null>(null);
	let canvas_element = $state<HTMLCanvasElement | null>(null);
	let canvas_context = $state<CanvasRenderingContext2D | null>(null);
	let canvas_width_px = $state(1);
	let canvas_height_px = $state(1);
	let active_drag = $state<ActiveKeyDrag | null>(null);
	let active_canvas_pan = $state<ActiveCanvasPan | null>(null);
	let drag_edit_session = $state<UiEditSession | null>(null);
	let hover_curve_position = $state<{ position: number; value: number } | null>(null);

	let interaction_transform: CanvasTransform | null = null;
	let queued_drag_target: DragPreview | null = null;
	let queued_drag_key_id: NodeId | null = null;
	let drag_commit_raf_id = 0;
	const float_bits_view = new DataView(new ArrayBuffer(8));

	const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
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
			value: candidate.data.param.value
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
					p1y = finite_or(start.value + out_value * value_span, start.value + value_span / 3);
					p2y = finite_or(start.value + in_value * value_span, start.value + (value_span * 2) / 3);
				} else {
					p1x = finite_or(out_position, start.position + span / 3);
					p2x = finite_or(in_position, start.position + (span * 2) / 3);
					p1y = finite_or(out_value, start.value + value_span / 3);
					p2y = finite_or(in_value, start.value + (value_span * 2) / 3);
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
			const resolved_amplitude =
				easing.coordinate_space === 'relative'
					? easing.amplitude * Math.abs(segment.value_delta)
					: easing.amplitude;
			const wave = shape_wave(easing.shape, easing.phase_cycles * progress);
			return linear_value + resolved_amplitude * wave * envelope;
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

	const sample_compiled_curve = (compiled_curve: CompiledCurve, position: number): number | null => {
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

	const is_step_multiple = (value: number, step: number): boolean => {
		if (!(step > CURVE_EPSILON) || !Number.isFinite(value)) {
			return false;
		}
		const ratio = value / step;
		const rounded = Math.round(ratio);
		return Math.abs(ratio - rounded) <= 1e-6 * Math.max(1, Math.abs(ratio));
	};

	const blended_grid_steps = (ideal_step: number): GridBlendStep[] => {
		if (!Number.isFinite(ideal_step) || ideal_step <= CURVE_EPSILON) {
			return [{ step: 1, weight: 1 }];
		}

		const exponent = Math.floor(Math.log10(ideal_step));
		const candidates: number[] = [];
		for (let level = exponent - 2; level <= exponent + 2; level += 1) {
			const decade = 10 ** level;
			for (const mantissa of GRID_MANTISSAS) {
				candidates.push(mantissa * decade);
			}
		}
		candidates.sort((left, right) => left - right);

		let lower = candidates[0];
		let upper = candidates[candidates.length - 1];
		for (const candidate of candidates) {
			if (candidate <= ideal_step) {
				lower = candidate;
			}
			if (candidate >= ideal_step) {
				upper = candidate;
				break;
			}
		}

		if (Math.abs(upper - lower) <= CURVE_EPSILON) {
			return [{ step: lower, weight: 1 }];
		}

		const log_lower = Math.log(lower);
		const log_upper = Math.log(upper);
		const span = log_upper - log_lower;
		if (Math.abs(span) <= CURVE_EPSILON) {
			return [{ step: lower, weight: 1 }];
		}
		const blend = clamp((Math.log(ideal_step) - log_lower) / span, 0, 1);
		const lower_weight = 1 - blend;
		const upper_weight = blend;
		const levels: GridBlendStep[] = [];
		if (lower_weight > 0.03) {
			levels.push({ step: lower, weight: lower_weight });
		}
		if (upper_weight > 0.03) {
			levels.push({ step: upper, weight: upper_weight });
		}
		if (levels.length === 0) {
			levels.push({ step: blend >= 0.5 ? upper : lower, weight: 1 });
		}
		return levels;
	};

	const draw_grid_lines = (
		context: CanvasRenderingContext2D,
		min_value: number,
		max_value: number,
		step: number,
		skip_step: number | null,
		alpha: number,
		line_width: number,
		to_screen: (value: number) => number,
		is_vertical: boolean,
		line_start: number,
		line_end: number
	): void => {
		if (
			alpha <= 0 ||
			!Number.isFinite(step) ||
			step <= CURVE_EPSILON ||
			!Number.isFinite(min_value) ||
			!Number.isFinite(max_value)
		) {
			return;
		}

		const start_index = Math.ceil((min_value - step * 1e-9) / step);
		const end_index = Math.floor((max_value + step * 1e-9) / step);
		const line_count = end_index - start_index + 1;
		if (line_count <= 0 || line_count > GRID_MAX_LINES) {
			return;
		}

		context.strokeStyle = `rgba(168, 186, 223, ${alpha})`;
		context.lineWidth = line_width;
		context.beginPath();
		let has_line = false;

		for (let index = start_index; index <= end_index; index += 1) {
			const value = index * step;
			if (skip_step !== null && is_step_multiple(value, skip_step)) {
				continue;
			}

			const screen = to_screen(value);
			if (!Number.isFinite(screen)) {
				continue;
			}

			if (is_vertical) {
				context.moveTo(screen, line_start);
				context.lineTo(screen, line_end);
			} else {
				context.moveTo(line_start, screen);
				context.lineTo(line_end, screen);
			}
			has_line = true;
		}

		if (has_line) {
			context.stroke();
		}
	};

	const draw_adaptive_axis_grid = (
		context: CanvasRenderingContext2D,
		min_value: number,
		max_value: number,
		axis_pixels: number,
		target_major_spacing_px: number,
		to_screen: (value: number) => number,
		is_vertical: boolean,
		line_start: number,
		line_end: number
	): void => {
		const span = max_value - min_value;
		if (!Number.isFinite(span) || span <= CURVE_EPSILON || axis_pixels <= CURVE_EPSILON) {
			return;
		}

		const ideal_major_step = (span * target_major_spacing_px) / Math.max(1, axis_pixels);
		const levels = blended_grid_steps(Math.max(ideal_major_step, CURVE_EPSILON));
		for (const level of levels) {
			const major_step = level.step;
			const major_px = (major_step / span) * axis_pixels;
			if (!Number.isFinite(major_px) || major_px < GRID_MIN_PIXEL_SPACING) {
				continue;
			}

			const major_visibility = clamp(
				(major_px - GRID_MIN_PIXEL_SPACING) / (GRID_MIN_PIXEL_SPACING * 2.8),
				0,
				1
			);
			const major_alpha = (0.06 + 0.17 * level.weight) * major_visibility;
			draw_grid_lines(
				context,
				min_value,
				max_value,
				major_step,
				null,
				major_alpha,
				1,
				to_screen,
				is_vertical,
				line_start,
				line_end
			);

			const minor_step = major_step / 5;
			const minor_px = major_px / 5;
			if (minor_px >= GRID_MIN_PIXEL_SPACING * 0.85) {
				const minor_visibility = clamp(
					(minor_px - GRID_MIN_PIXEL_SPACING * 0.85) / (GRID_MIN_PIXEL_SPACING * 3.3),
					0,
					1
				);
				const minor_alpha = (0.03 + 0.1 * level.weight) * minor_visibility;
				draw_grid_lines(
					context,
					min_value,
					max_value,
					minor_step,
					major_step,
					minor_alpha,
					0.75,
					to_screen,
					is_vertical,
					line_start,
					line_end
				);
			}

			const micro_step = minor_step / 2;
			const micro_px = minor_px / 2;
			if (micro_px >= GRID_MIN_PIXEL_SPACING * 1.1) {
				const micro_visibility = clamp(
					(micro_px - GRID_MIN_PIXEL_SPACING * 1.1) / (GRID_MIN_PIXEL_SPACING * 3.6),
					0,
					1
				);
				const micro_alpha = (0.018 + 0.052 * level.weight) * micro_visibility;
				draw_grid_lines(
					context,
					min_value,
					max_value,
					micro_step,
					minor_step,
					micro_alpha,
					0.6,
					to_screen,
					is_vertical,
					line_start,
					line_end
				);
			}
		}
	};

	const dominant_grid_step = (
		min_value: number,
		max_value: number,
		axis_pixels: number,
		target_major_spacing_px: number
	): number => {
		const span = max_value - min_value;
		if (!Number.isFinite(span) || span <= CURVE_EPSILON || axis_pixels <= CURVE_EPSILON) {
			return 1;
		}
		const ideal_major_step = (span * target_major_spacing_px) / Math.max(1, axis_pixels);
		const levels = blended_grid_steps(Math.max(ideal_major_step, CURVE_EPSILON));
		let best = levels[0] ?? { step: 1, weight: 1 };
		for (const level of levels) {
			if (level.weight > best.weight) {
				best = level;
			}
		}
		return Math.max(CURVE_EPSILON, best.step);
	};

	const draw_axis_tick_labels = (
		context: CanvasRenderingContext2D,
		min_value: number,
		max_value: number,
		step: number,
		to_screen: (value: number) => number,
		axis: 'x' | 'y',
		plot_left: number,
		plot_top: number,
		plot_width: number,
		plot_height: number,
		font_px: number
	): void => {
		if (!(step > CURVE_EPSILON) || !Number.isFinite(min_value) || !Number.isFinite(max_value)) {
			return;
		}
		const start_index = Math.ceil((min_value - step * 1e-9) / step);
		const end_index = Math.floor((max_value + step * 1e-9) / step);
		const tick_count = end_index - start_index + 1;
		if (tick_count <= 0 || tick_count > 120) {
			return;
		}

		context.font = `${Math.max(8, font_px)}px sans-serif`;
		context.fillStyle = 'rgba(205, 221, 247, 0.7)';
		if (axis === 'x') {
			let previous_right = Number.NEGATIVE_INFINITY;
			for (let index = start_index; index <= end_index; index += 1) {
				const value = index * step;
				const x = to_screen(value);
				if (x < plot_left || x > plot_left + plot_width) {
					continue;
				}
				const label = format_number(value);
				const text_width = context.measureText(label).width;
				const left = x - text_width * 0.5;
				const right = x + text_width * 0.5;
				if (left <= previous_right + font_px * 0.45) {
					continue;
				}
				previous_right = right;
				context.fillText(label, left, plot_top + plot_height + font_px * 1.16);
			}
			return;
		}

		let previous_y = Number.NEGATIVE_INFINITY;
		for (let index = start_index; index <= end_index; index += 1) {
			const value = index * step;
			const y = to_screen(value);
			if (y < plot_top || y > plot_top + plot_height) {
				continue;
			}
			if (y - previous_y < font_px * 1.18) {
				continue;
			}
			previous_y = y;
			const label = format_number(value);
			context.fillText(label, plot_left + font_px * 0.2, y - font_px * 0.16);
		}
	};

	const format_number = (value: number): string => {
		if (!Number.isFinite(value)) {
			return '0';
		}
		if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
			return value.toExponential(2);
		}
		return value.toFixed(3).replace(/\.?0+$/, '');
	};

	const set_numeric_param = async (ref: ParamNodeRef | undefined, value: number): Promise<void> => {
		if (!ref || !Number.isFinite(value)) {
			return;
		}
		if (ref.value.kind === 'int') {
			await sendSetParamIntent(ref.node_id, { kind: 'int', value: Math.round(value) }, 'Coalesce');
			return;
		}
		await sendSetParamIntent(ref.node_id, { kind: 'float', value }, 'Coalesce');
	};

	const set_drag_preview = (key_id: NodeId, position: number, value: number): void => {
		const next = new Map(drag_preview_by_key_id);
		next.set(key_id, { position, value });
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
	let selected_key = $derived.by((): ParsedCurveKey | null => {
		if (selected_key_id === null) {
			return null;
		}
		return parsed_key_by_id.get(selected_key_id) ?? null;
	});
	let selected_key_node = $derived.by((): UiNodeDto | null => {
		if (selected_key_id === null) {
			return null;
		}
		return graphNodesById?.get(selected_key_id) ?? null;
	});
	let key_creatable_item = $derived.by(
		() =>
			liveNode.creatable_user_items.find(
				(item) => item.node_type === KEY_NODE_TYPE || item.item_kind === KEY_ITEM_KIND
			) ?? null
	);
	let compiled_curve = $derived.by(() => compile_curve(parsed_keys));
	let key_count_label = $derived(`${parsed_keys.length} key${parsed_keys.length === 1 ? '' : 's'}`);

	$effect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const refresh = (): void => {
			const parsed = Number.parseFloat(
				window.getComputedStyle(document.documentElement).fontSize
			);
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
			selected_key_id = null;
			return;
		}
		if (selected_key_id !== null && parsed_key_by_id.has(selected_key_id)) {
			return;
		}
		selected_key_id = parsed_keys[0].node_id;
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
			selected_key_id = key.node_id;
			void set_numeric_param(key.position_param, pending.position);
			void set_numeric_param(key.value_param, pending.value);
			pending_create_target = null;
			return;
		}
	});

	$effect(() => {
		if (!canvas_element || typeof window === 'undefined') {
			canvas_context = null;
			return;
		}
		const context = canvas_element.getContext('2d');
		if (!context) {
			canvas_context = null;
			return;
		}
		canvas_context = context;

		const sync_canvas_size = (): void => {
			if (!canvas_element) {
				return;
			}
			const rect = canvas_element.getBoundingClientRect();
			const css_width = Math.max(1, rect.width);
			const css_height = Math.max(1, rect.height);
			const dpr = Math.max(1, window.devicePixelRatio || 1);
			const device_width = Math.max(1, Math.round(css_width * dpr));
			const device_height = Math.max(1, Math.round(css_height * dpr));

			canvas_width_px = css_width;
			canvas_height_px = css_height;

			if (
				canvas_element.width !== device_width ||
				canvas_element.height !== device_height
			) {
				canvas_element.width = device_width;
				canvas_element.height = device_height;
			}
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
		};

		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined') {
			observer = new ResizeObserver(sync_canvas_size);
			observer.observe(canvas_element);
		}
		sync_canvas_size();

		return () => {
			observer?.disconnect();
			canvas_context = null;
		};
	});

	const draw_curve_canvas = (): void => {
		if (!canvas_context || !compiled_curve) {
			return;
		}
		const context = canvas_context;
		const width = Math.max(1, canvas_width_px);
		const height = Math.max(1, canvas_height_px);

		context.clearRect(0, 0, width, height);
		context.fillStyle = 'rgba(7, 13, 24, 0.98)';
		context.fillRect(0, 0, width, height);

		const keys = compiled_curve.keys;
		if (keys.length === 0) {
			context.fillStyle = 'rgba(192, 206, 232, 0.64)';
			context.font = `${Math.max(9, Math.round(height * 0.065))}px sans-serif`;
			context.fillText('No keys in this curve', width * 0.04, height * 0.18);
			fixed_view_bounds = null;
			interaction_transform = null;
			return;
		}

		const pad_left = width * 0.06;
		const pad_right = width * 0.03;
		const pad_top = height * 0.08;
		const pad_bottom = height * 0.14;
		const plot_width = Math.max(1, width - pad_left - pad_right);
		const plot_height = Math.max(1, height - pad_top - pad_bottom);
		const plot_left = pad_left;
		const plot_top = pad_top;

		let x_min = keys[0].position;
		let x_max = keys[keys.length - 1].position;
		if (!Number.isFinite(x_min) || !Number.isFinite(x_max)) {
			x_min = 0;
			x_max = 1;
		}
		if (Math.abs(x_max - x_min) <= CURVE_EPSILON) {
			x_min -= 0.5;
			x_max += 0.5;
		}

		const sample_count = Math.max(192, Math.min(4096, Math.round(plot_width * 2.4)));
		let sample_step = (x_max - x_min) / Math.max(1, sample_count - 1);
		const sample_values = new Float64Array(sample_count);
		let y_min = Number.POSITIVE_INFINITY;
		let y_max = Number.NEGATIVE_INFINITY;

		for (let index = 0; index < sample_count; index += 1) {
			const position = index + 1 === sample_count ? x_max : x_min + sample_step * index;
			const sample = sample_compiled_curve(compiled_curve, position);
			const value = sample ?? 0;
			sample_values[index] = value;
			if (value < y_min) {
				y_min = value;
			}
			if (value > y_max) {
				y_max = value;
			}
		}

		for (const key of parsed_keys) {
			if (key.value < y_min) {
				y_min = key.value;
			}
			if (key.value > y_max) {
				y_max = key.value;
			}
		}
		if (!Number.isFinite(y_min) || !Number.isFinite(y_max)) {
			y_min = -1;
			y_max = 1;
		}
		if (Math.abs(y_max - y_min) <= CURVE_EPSILON) {
			const delta = Math.max(0.5, Math.abs(y_max) * 0.2);
			y_min -= delta;
			y_max += delta;
		}
		const value_pad = (y_max - y_min) * 0.08;
		y_min -= value_pad;
		y_max += value_pad;

		const adaptive_bounds: CurveViewBounds = { x_min, x_max, y_min, y_max };
		let active_bounds = adaptive_bounds;
		if (curve_view_mode === 'fixed') {
			if (fixed_view_bounds) {
				active_bounds = fixed_view_bounds;
			} else {
				fixed_view_bounds = adaptive_bounds;
			}
		} else if (fixed_view_bounds) {
			fixed_view_bounds = null;
		}

		if (
			Math.abs(active_bounds.x_min - x_min) > CURVE_EPSILON ||
			Math.abs(active_bounds.x_max - x_max) > CURVE_EPSILON
		) {
			x_min = active_bounds.x_min;
			x_max = active_bounds.x_max;
			sample_step = (x_max - x_min) / Math.max(1, sample_count - 1);
			for (let index = 0; index < sample_count; index += 1) {
				const position = index + 1 === sample_count ? x_max : x_min + sample_step * index;
				const sample = sample_compiled_curve(compiled_curve, position);
				sample_values[index] = sample ?? 0;
			}
		}

		if (curve_view_mode === 'fixed') {
			y_min = active_bounds.y_min;
			y_max = active_bounds.y_max;
		} else {
			y_min = adaptive_bounds.y_min;
			y_max = adaptive_bounds.y_max;
		}

		const x_span = Math.max(CURVE_EPSILON, x_max - x_min);
		const y_span = Math.max(CURVE_EPSILON, y_max - y_min);
		const to_screen_x = (position: number): number =>
			plot_left + ((position - x_min) / x_span) * plot_width;
		const to_screen_y = (value: number): number =>
			plot_top + plot_height - ((value - y_min) / y_span) * plot_height;

		const sample_screen_x = new Float64Array(sample_count);
		const sample_screen_y = new Float64Array(sample_count);
		const sample_owner_key_ids: Array<NodeId | null> = new Array(sample_count).fill(null);
		const segments = compiled_curve.segments;
		let active_segment_index = 0;
		for (let index = 0; index < sample_count; index += 1) {
			const position = index + 1 === sample_count ? x_max : x_min + sample_step * index;
			sample_screen_x[index] = to_screen_x(position);
			sample_screen_y[index] = to_screen_y(sample_values[index]);

			while (
				active_segment_index + 1 < segments.length &&
				position > segments[active_segment_index].end_position + CURVE_EPSILON
			) {
				active_segment_index += 1;
			}
			const segment = segments[active_segment_index];
			if (
				segment &&
				position >= segment.start_position - CURVE_EPSILON &&
				position <= segment.end_position + CURVE_EPSILON
			) {
				sample_owner_key_ids[index] = compiled_curve.keys[active_segment_index]?.node_id ?? null;
			}
		}

		const target_major_spacing_px = Math.max(28, rem_base_px * 4.4);
		draw_adaptive_axis_grid(
			context,
			x_min,
			x_max,
			plot_width,
			target_major_spacing_px,
			to_screen_x,
			true,
			plot_top,
			plot_top + plot_height
		);
		draw_adaptive_axis_grid(
			context,
			y_min,
			y_max,
			plot_height,
			target_major_spacing_px,
			to_screen_y,
			false,
			plot_left,
			plot_left + plot_width
		);

		if (x_min <= 0 && x_max >= 0) {
			const x0 = to_screen_x(0);
			context.strokeStyle = 'rgba(210, 226, 255, 0.24)';
			context.lineWidth = 1.05;
			context.beginPath();
			context.moveTo(x0, plot_top);
			context.lineTo(x0, plot_top + plot_height);
			context.stroke();
		}
		if (y_min <= 0 && y_max >= 0) {
			const y0 = to_screen_y(0);
			context.strokeStyle = 'rgba(210, 226, 255, 0.24)';
			context.lineWidth = 1.05;
			context.beginPath();
			context.moveTo(plot_left, y0);
			context.lineTo(plot_left + plot_width, y0);
			context.stroke();
		}

		context.strokeStyle = 'rgba(88, 236, 201, 0.95)';
		context.lineWidth = 1.35;
		context.lineJoin = 'round';
		context.lineCap = 'round';
		const bucket_count = Math.max(1, Math.round(plot_width));
		if (sample_count > bucket_count * 2) {
			const bucket_min = new Float64Array(bucket_count);
			const bucket_max = new Float64Array(bucket_count);
			const bucket_first = new Float64Array(bucket_count);
			const bucket_last = new Float64Array(bucket_count);
			const bucket_has = new Uint8Array(bucket_count);
			for (let index = 0; index < bucket_count; index += 1) {
				bucket_min[index] = Number.POSITIVE_INFINITY;
				bucket_max[index] = Number.NEGATIVE_INFINITY;
			}
			for (let index = 0; index < sample_count; index += 1) {
				const value = sample_values[index];
				const sample_x = sample_screen_x[index];
				const bucket = clamp(Math.floor(sample_x - plot_left), 0, bucket_count - 1);
				if (!bucket_has[bucket]) {
					bucket_has[bucket] = 1;
					bucket_first[bucket] = value;
					bucket_last[bucket] = value;
					bucket_min[bucket] = value;
					bucket_max[bucket] = value;
					continue;
				}
				bucket_last[bucket] = value;
				if (value < bucket_min[bucket]) {
					bucket_min[bucket] = value;
				}
				if (value > bucket_max[bucket]) {
					bucket_max[bucket] = value;
				}
			}
			context.beginPath();
			let has_path_point = false;
			for (let index = 0; index < bucket_count; index += 1) {
				if (!bucket_has[index]) {
					continue;
				}
				const x = plot_left + index + 0.5;
				const first_y = to_screen_y(bucket_first[index]);
				const last_y = to_screen_y(bucket_last[index]);
				if (!has_path_point) {
					context.moveTo(x, first_y);
					has_path_point = true;
				} else {
					context.lineTo(x, first_y);
				}
				context.lineTo(x, last_y);
			}
			context.stroke();

			context.beginPath();
			for (let index = 0; index < bucket_count; index += 1) {
				if (!bucket_has[index]) {
					continue;
				}
				const min_y = to_screen_y(bucket_min[index]);
				const max_y = to_screen_y(bucket_max[index]);
				if (Math.abs(max_y - min_y) <= 0.35) {
					continue;
				}
				const x = plot_left + index + 0.5;
				context.moveTo(x, min_y);
				context.lineTo(x, max_y);
			}
			context.stroke();
		} else {
			context.beginPath();
			for (let index = 0; index < sample_count; index += 1) {
				const x = sample_screen_x[index];
				const y = sample_screen_y[index];
				if (index === 0) {
					context.moveTo(x, y);
				} else {
					context.lineTo(x, y);
				}
			}
			context.stroke();
		}

		const stroke_owned_segment = (
			key_id: NodeId,
			stroke_style: string,
			line_width: number
		): boolean => {
			context.strokeStyle = stroke_style;
			context.lineWidth = line_width;
			context.beginPath();
			let drawing = false;
			let has_path = false;

			for (let index = 0; index < sample_count; index += 1) {
				if (sample_owner_key_ids[index] !== key_id) {
					drawing = false;
					continue;
				}

				const x = sample_screen_x[index];
				const y = sample_screen_y[index];
				if (!drawing) {
					context.moveTo(x, y);
					drawing = true;
					has_path = true;
				} else {
					context.lineTo(x, y);
				}
			}

			if (has_path) {
				context.stroke();
			}
			return has_path;
		};

		if (hover_key_id !== null && hover_key_id !== selected_key_id) {
			if (stroke_owned_segment(hover_key_id, 'rgba(255, 171, 103, 0.25)', 2.6)) {
				stroke_owned_segment(hover_key_id, 'rgba(255, 197, 139, 0.82)', 1.35);
			}
		}

		if (selected_key_id !== null) {
			if (stroke_owned_segment(selected_key_id, 'rgba(255, 224, 126, 0.32)', 3.1)) {
				stroke_owned_segment(selected_key_id, 'rgba(255, 232, 149, 0.94)', 1.75);
			}
		}

		const key_screen_points = new Map<NodeId, { x: number; y: number }>();
		const key_stride = parsed_keys.length > 2200 ? Math.ceil(parsed_keys.length / 2200) : 1;
		for (let index = 0; index < parsed_keys.length; index += 1) {
			const key = parsed_keys[index];
			const x = to_screen_x(key.position);
			const y = to_screen_y(key.value);
			key_screen_points.set(key.node_id, { x, y });

			const selected = key.node_id === selected_key_id;
			const hovered = key.node_id === hover_key_id;
			if (!selected && !hovered && index % key_stride !== 0) {
				continue;
			}

			const radius = selected ? Math.max(2, rem_base_px * 0.27) : Math.max(1.5, rem_base_px * 0.2);
			context.fillStyle = selected
				? 'rgba(255, 229, 112, 0.98)'
				: hovered
					? 'rgba(255, 182, 96, 0.95)'
					: 'rgba(177, 227, 255, 0.82)';
			context.strokeStyle = 'rgba(8, 12, 18, 0.9)';
			context.lineWidth = selected ? 1.25 : 1;
			context.beginPath();
			context.arc(x, y, radius, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}

		if (selected_key) {
			const selected_point = key_screen_points.get(selected_key.node_id);
			if (selected_point) {
				context.strokeStyle = 'rgba(255, 226, 117, 0.35)';
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(selected_point.x, plot_top);
				context.lineTo(selected_point.x, plot_top + plot_height);
				context.stroke();
			}
		}

		const axis_label_font_px = Math.max(8, Math.round(height * 0.045));
		const x_label_step = dominant_grid_step(x_min, x_max, plot_width, target_major_spacing_px);
		const y_label_step = dominant_grid_step(y_min, y_max, plot_height, target_major_spacing_px);
		draw_axis_tick_labels(
			context,
			x_min,
			x_max,
			x_label_step,
			to_screen_x,
			'x',
			plot_left,
			plot_top,
			plot_width,
			plot_height,
			axis_label_font_px
		);
		draw_axis_tick_labels(
			context,
			y_min,
			y_max,
			y_label_step,
			to_screen_y,
			'y',
			plot_left,
			plot_top,
			plot_width,
			plot_height,
			axis_label_font_px
		);

		if (hover_curve_position) {
			const cross_x = to_screen_x(hover_curve_position.position);
			const cross_y = to_screen_y(hover_curve_position.value);
			if (
				cross_x >= plot_left &&
				cross_x <= plot_left + plot_width &&
				cross_y >= plot_top &&
				cross_y <= plot_top + plot_height
			) {
				context.setLineDash([Math.max(2, rem_base_px * 0.12), Math.max(2, rem_base_px * 0.16)]);
				context.strokeStyle = 'rgba(217, 231, 255, 0.34)';
				context.lineWidth = 0.9;
				context.beginPath();
				context.moveTo(cross_x, plot_top);
				context.lineTo(cross_x, plot_top + plot_height);
				context.moveTo(plot_left, cross_y);
				context.lineTo(plot_left + plot_width, cross_y);
				context.stroke();
				context.setLineDash([]);

				const cursor_label = `x ${format_number(hover_curve_position.position)}  y ${format_number(hover_curve_position.value)}`;
				context.font = `${Math.max(8, Math.round(height * 0.043))}px sans-serif`;
				const label_padding = rem_base_px * 0.22;
				const label_width = context.measureText(cursor_label).width + label_padding * 2;
				const label_height = axis_label_font_px + label_padding * 1.6;
				const label_x = clamp(
					cross_x + rem_base_px * 0.38,
					plot_left + rem_base_px * 0.2,
					plot_left + plot_width - label_width - rem_base_px * 0.2
				);
				const label_y = clamp(
					cross_y - label_height - rem_base_px * 0.28,
					plot_top + rem_base_px * 0.2,
					plot_top + plot_height - label_height - rem_base_px * 0.2
				);
				context.fillStyle = 'rgba(7, 13, 24, 0.9)';
				context.fillRect(label_x, label_y, label_width, label_height);
				context.strokeStyle = 'rgba(191, 212, 245, 0.5)';
				context.lineWidth = 0.8;
				context.strokeRect(label_x, label_y, label_width, label_height);
				context.fillStyle = 'rgba(225, 236, 255, 0.95)';
				context.fillText(
					cursor_label,
					label_x + label_padding,
					label_y + label_height - label_padding * 0.65
				);
			}
		}

		context.fillStyle = 'rgba(186, 205, 236, 0.68)';
		context.font = `${Math.max(8, Math.round(height * 0.041))}px sans-serif`;
		const viewport_label = `x ${format_number(x_min)}..${format_number(x_max)}   y ${format_number(y_min)}..${format_number(y_max)}`;
		context.fillText(viewport_label, plot_left + rem_base_px * 0.2, plot_top + axis_label_font_px * 1.05);

		interaction_transform = {
			plot_left,
			plot_top,
			plot_width,
			plot_height,
			x_min,
			x_max,
			y_min,
			y_max,
			key_screen_points,
			curve_screen_x: sample_screen_x,
			curve_screen_y: sample_screen_y,
			curve_owner_key_ids: sample_owner_key_ids
		};
	};

	$effect(() => {
		canvas_context;
		canvas_width_px;
		canvas_height_px;
		compiled_curve;
		parsed_keys;
		selected_key_id;
		hover_key_id;
		hover_curve_position;
		rem_base_px;
		curve_view_mode;
		fixed_view_bounds;
		draw_curve_canvas();
	});

	const canvas_local_point = (event: MouseEvent | PointerEvent): { x: number; y: number } | null => {
		if (!canvas_element) {
			return null;
		}
		const rect = canvas_element.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
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
		return {
			position:
				interaction_transform.x_min +
				normalized_x * (interaction_transform.x_max - interaction_transform.x_min),
			value:
				interaction_transform.y_max -
				normalized_y * (interaction_transform.y_max - interaction_transform.y_min)
		};
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

	const pan_view_by_pixels = (delta_screen_x: number, delta_screen_y: number): void => {
		const base = current_view_bounds();
		if (!base || !interaction_transform) {
			return;
		}
		const units_per_px_x = (base.x_max - base.x_min) / Math.max(1, interaction_transform.plot_width);
		const units_per_px_y = (base.y_max - base.y_min) / Math.max(1, interaction_transform.plot_height);
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
			scale = Math.max(canvas_width_px, canvas_height_px);
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

	const flush_queued_drag = (): void => {
		if (!queued_drag_target || queued_drag_key_id === null) {
			return;
		}
		const key = parsed_key_by_id.get(queued_drag_key_id);
		if (!key) {
			return;
		}
		void set_numeric_param(key.position_param, queued_drag_target.position);
		void set_numeric_param(key.value_param, queued_drag_target.value);
		queued_drag_target = null;
		queued_drag_key_id = null;
	};

	const queue_drag_commit = (key_id: NodeId, position: number, value: number): void => {
		queued_drag_target = { position, value };
		queued_drag_key_id = key_id;
		if (drag_commit_raf_id !== 0 || typeof window === 'undefined') {
			return;
		}
		drag_commit_raf_id = window.requestAnimationFrame(() => {
			drag_commit_raf_id = 0;
			flush_queued_drag();
		});
	};

	const finish_drag = (pointer_id?: number): void => {
		if (!active_drag) {
			return;
		}
		if (pointer_id !== undefined && active_drag.pointer_id !== pointer_id) {
			return;
		}
		flush_queued_drag();
		clear_drag_preview(active_drag.key_id);
		const release_pointer_id = pointer_id ?? active_drag.pointer_id;
		if (canvas_element && canvas_element.hasPointerCapture(release_pointer_id)) {
			canvas_element.releasePointerCapture(release_pointer_id);
		}
		active_drag = null;
		if (drag_edit_session) {
			void drag_edit_session.end();
			drag_edit_session = null;
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

	const on_canvas_pointer_down = (event: PointerEvent): void => {
		if (!interaction_transform || !canvas_element) {
			return;
		}
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}
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

		const selection = nearest_key(point.x, point.y, Math.max(6, rem_base_px * 0.62));
		if (selection !== null) {
			selected_key_id = selection;

			const key = parsed_key_by_id.get(selection);
			if (!key?.position_param || !key.value_param) {
				return;
			}

			const edit_session = createUiEditSession('Move Curve Key', 'curve-key-drag');
			void edit_session.begin();
			drag_edit_session = edit_session;
			active_drag = {
				key_id: selection,
				pointer_id: event.pointerId
			};
			canvas_element.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}

		const curve_selection = nearest_curve_owner_key(point.x, point.y, Math.max(4, rem_base_px * 0.45));
		if (curve_selection !== null) {
			selected_key_id = curve_selection;
			return;
		}

		selected_key_id = null;
	};

	const on_canvas_pointer_move = (event: PointerEvent): void => {
		const point = canvas_local_point(event);
		if (!point) {
			return;
		}
		hover_curve_position = screen_to_curve_point(point.x, point.y);

		if (active_canvas_pan && active_canvas_pan.pointer_id === event.pointerId && interaction_transform) {
			hover_key_id = null;
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

		if (active_drag && active_drag.pointer_id === event.pointerId) {
			const curve_point = screen_to_curve_point(point.x, point.y);
			if (!curve_point) {
				return;
			}
			set_drag_preview(active_drag.key_id, curve_point.position, curve_point.value);
			queue_drag_commit(active_drag.key_id, curve_point.position, curve_point.value);
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
		adding_key = true;
		pending_create_target = {
			known_key_ids: new Set(parsed_keys.map((entry) => entry.node_id)),
			position,
			value
		};
		const created = await sendCreateUserItemIntent(liveNode.node_id, key_creatable_item);
		adding_key = false;
		if (!created) {
			pending_create_target = null;
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
		selected_key_id = next_fallback?.node_id ?? null;
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
		};
	});
</script>

{#snippet curveHeaderExtra()}
	<span class="curve-key-pill">{key_count_label}</span>
	{#if level > 0}
		<SelectNodeButton {node} />
	{/if}
{/snippet}

{#if liveNode.node_type === CURVE_NODE_TYPE}
	{@render defaultHeader?.(curveHeaderExtra)}
	<div class="node-inspector-content animation-curve-node-inspector">
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
		<div class="curve-nav-hint">
			Wheel: zoom | Shift + wheel: horizontal pan | Alt + wheel: vertical pan | Middle drag:
			pan
		</div>

		<div class="curve-canvas-wrap">
			<canvas
				class="curve-canvas {active_canvas_pan ? 'panning' : ''}"
				bind:this={canvas_element}
				onpointerdown={on_canvas_pointer_down}
				onpointermove={on_canvas_pointer_move}
				onpointerup={on_canvas_pointer_up}
				onpointercancel={on_canvas_pointer_cancel}
				onpointerleave={on_canvas_pointer_leave}
				onwheel={on_canvas_wheel}
				ondblclick={on_canvas_double_click}></canvas>
		</div>

		<section class="curve-key-editor">
			<div class="section-title">Selected Key</div>
			{#if selected_key_node}
				<div class="selected-key-node-inspector">
					<NodeInspector nodes={[selected_key_node]} level={level + 1} order="solo" />
				</div>
			{:else}
				<div class="empty-state">Select one key on the curve to edit it.</div>
			{/if}
		</section>
	</div>
{/if}

<style>
	.animation-curve-node-inspector {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.32rem;
		border-radius: 0.45rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.11);
		background:
			radial-gradient(110% 120% at 10% 0%, rgba(74, 124, 196, 0.25), transparent 52%),
			radial-gradient(95% 110% at 90% 100%, rgba(50, 206, 176, 0.18), transparent 58%),
			rgba(6, 10, 16, 0.78);
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

	.curve-canvas-wrap {
		height: min(26rem, 38vh);
		border-radius: 0.44rem;
		overflow: hidden;
		border: solid 0.06rem rgba(189, 215, 247, 0.26);
		background: rgba(0, 0, 0, 0.24);
	}

	.curve-canvas {
		display: block;
		width: 100%;
		height: 100%;
		cursor: crosshair;
	}

	.curve-canvas.panning {
		cursor: grabbing;
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

	.section-title {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		margin-bottom: 0.22rem;
		color: rgba(229, 239, 255, 0.9);
	}

	.curve-key-editor {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-radius: 0.34rem;
		border: solid 0.06rem rgba(191, 213, 248, 0.2);
		background: rgba(7, 12, 20, 0.58);
		padding: 0.25rem;
	}

	.selected-key-node-inspector {
		max-height: 22rem;
		overflow: auto;
		padding-right: 0.2rem;
	}

	.empty-state {
		font-size: 0.67rem;
		opacity: 0.68;
		padding: 0.45rem;
		border-radius: 0.28rem;
		background: rgba(255, 255, 255, 0.03);
	}

	.curve-key-pill {
		display: inline-flex;
		align-items: center;
		height: 1.02rem;
		padding: 0 0.42rem;
		border-radius: 999rem;
		font-size: 0.6rem;
		background: rgba(255, 225, 119, 0.15);
		border: solid 0.06rem rgba(255, 224, 106, 0.34);
	}

	@media (max-width: 58rem) {
		.curve-canvas-wrap {
			height: min(22rem, 42vh);
		}
	}
</style>
