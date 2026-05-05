import type { NodeId, UiEventDto } from '../../types';

export const TRIGGER_PARAM_EVENT_TOPIC = '__param.trigger';

export interface WorkbenchCustomEventStore {
	getCustomEventSequence(topic: string, origin?: NodeId | null): number;
	applyBatchEvents(events: UiEventDto[]): void;
	reset(): void;
}

const customEventKey = (topic: string, origin: NodeId | null | undefined): string =>
	`${topic}\u0000${origin ?? 'global'}`;

export const createWorkbenchCustomEventStore = (): WorkbenchCustomEventStore => {
	let sequencesByKey = $state<Record<string, number>>({});

	const getCustomEventSequence = (topic: string, origin?: NodeId | null): number => {
		return sequencesByKey[customEventKey(topic, origin)] ?? 0;
	};

	const applyBatchEvents = (events: UiEventDto[]): void => {
		let nextSequences: Record<string, number> | null = null;

		for (const event of events) {
			if (event.kind.kind === 'custom') {
				const key = customEventKey(event.kind.topic, event.kind.origin ?? null);
				nextSequences ??= { ...sequencesByKey };
				nextSequences[key] = (nextSequences[key] ?? 0) + 1;
				continue;
			}

			if (event.kind.kind === 'paramChanged' && event.kind.new_value.kind === 'trigger') {
				const key = customEventKey(TRIGGER_PARAM_EVENT_TOPIC, event.kind.param);
				nextSequences ??= { ...sequencesByKey };
				nextSequences[key] = (nextSequences[key] ?? 0) + 1;
			}
		}

		if (nextSequences !== null) {
			sequencesByKey = nextSequences;
		}
	};

	const reset = (): void => {
		sequencesByKey = {};
	};

	return {
		getCustomEventSequence,
		applyBatchEvents,
		reset
	};
};
