<script lang="ts">
	import '../../style/golden-core.css';

	import MainComponent from './MainComponent.svelte';
	import { onMount } from 'svelte';

	import type { Snippet } from 'svelte';
	import AppHeader from './AppHeader.svelte';
	import {
		appState,
		createWorkbenchSession,
		type WorkbenchSession
	} from '../../store/workbench.svelte';
	import AppFooter from './AppFooter.svelte';
	import type { PanelSpawnRequest, UserPanelDefinitionMap } from '../../dockview/panel-types';
	import type { NodeIconSet } from '../../store/node-types';
	import { platform } from '$lib/golden_ui/store/platform.svelte';

	const props = $props<{
		wsUrl?: string;
		httpBaseUrl?: string;
		pollIntervalMs?: number;
		bootstrapRetryMs?: number;
		userPanels?: UserPanelDefinitionMap;
		initialPanels?: PanelSpawnRequest[];
		nodeIcons?: NodeIconSet;
		children?: Snippet;
	}>();

	const createSession = (): WorkbenchSession =>
		createWorkbenchSession({
			wsUrl: props.wsUrl ?? 'ws://localhost:7010/api/ui/ws',
			httpBaseUrl: props.httpBaseUrl ?? 'http://localhost:7010/api/ui',
			pollIntervalMs: props.pollIntervalMs ?? 120,
			bootstrapRetryMs: props.bootstrapRetryMs ?? 1000
		});

	const session: WorkbenchSession = import.meta.hot?.data.workbenchSession ?? createSession();
	if (import.meta.hot) {
		import.meta.hot.data.workbenchSession = session;
	}

	appState.session = session;

	onMount(() => {
		const cleanup = session.mount();
		return () => {
			if (!import.meta.hot) {
				cleanup();
			}
		};
	});
</script>

<div class="gc-main os-{platform.name}">
	<AppHeader {session} />
	<MainComponent
		userPanels={props.userPanels}
		initialPanels={props.initialPanels}
		nodeIcons={props.nodeIcons} />
	<AppFooter {session} />
</div>
