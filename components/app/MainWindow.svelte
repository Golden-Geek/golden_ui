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

	let isWindowMaximized = $state(false);
	let hasTauriWindowApi = $state(false);

	const invokeAppCommand = async (
		command: string,
		args?: Record<string, unknown>
	): Promise<unknown | undefined> => {
		const invoke = window.__TAURI_INTERNALS__?.invoke;
		if (!invoke) {
			return undefined;
		}

		try {
			return await invoke(command, args);
		} catch (error) {
			console.error(`[window-controls] ${command} failed.`, error);
			return undefined;
		}
	};

	const refreshMaximizeState = async (): Promise<void> => {
		const maximized = await invokeAppCommand('window_is_maximized');
		isWindowMaximized = Boolean(maximized);
	};

	const minimizeWindow = async (): Promise<void> => {
		const result = await invokeAppCommand('window_minimize');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (minimize).');
		}
	};

	const toggleWindowMaximize = async (): Promise<void> => {
		const result = await invokeAppCommand('window_toggle_maximize');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (toggle maximize).');
			return;
		}
		await refreshMaximizeState();
	};

	const closeWindow = async (): Promise<void> => {
		const result = await invokeAppCommand('window_close');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (close).');
		}
	};

	onMount(() => {
		hasTauriWindowApi = Boolean(window.__TAURI_INTERNALS__?.invoke);
		if (!hasTauriWindowApi) {
			return;
		}

		void refreshMaximizeState();

		const onResize = () => {
			void refreshMaximizeState();
		};
		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
		};
	});
</script>

<div class="gc-main os-{platform.name}">
	<AppHeader {session} />
	<MainComponent
		userPanels={props.userPanels}
		initialPanels={props.initialPanels}
		nodeIcons={props.nodeIcons} />
	<AppFooter />
</div>
