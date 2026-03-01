<script lang="ts">
	import { Compartment, EditorState, type Extension } from '@codemirror/state';
	import { EditorView, placeholder as codeMirrorPlaceholder } from '@codemirror/view';
	import { javascript } from '@codemirror/lang-javascript';
	import { css } from '@codemirror/lang-css';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { basicSetup } from 'codemirror';
	import { onMount } from 'svelte';

	type CodeLanguage = 'javascript' | 'css' | 'plain';

	interface PersistedEditorState {
		anchor: number;
		head: number;
		scrollTop: number;
		scrollLeft: number;
		hadFocus: boolean;
	}

	const PERSISTED_EDITOR_STATE_LIMIT = 64;
	const persistedEditorStates = new Map<string, PersistedEditorState>();

	const normalizePersistKey = (value: string): string => value.trim();

	const persistEditorState = (key: string, state: PersistedEditorState): void => {
		if (persistedEditorStates.has(key)) {
			persistedEditorStates.delete(key);
		}
		persistedEditorStates.set(key, state);
		if (persistedEditorStates.size <= PERSISTED_EDITOR_STATE_LIMIT) {
			return;
		}
		const oldestKey = persistedEditorStates.keys().next().value;
		if (typeof oldestKey === 'string') {
			persistedEditorStates.delete(oldestKey);
		}
	};

	let {
		value = '',
		language = 'plain',
		readonly = false,
		placeholder = '',
		minHeight = '12rem',
		fill = false,
		persistKey = '',
		commitOnBlur = false,
		onchange = undefined,
		oncommit = undefined,
		onfocus = undefined,
		onblur = undefined
	} = $props<{
		value?: string;
		language?: CodeLanguage;
		readonly?: boolean;
		placeholder?: string;
		minHeight?: string;
		fill?: boolean;
		persistKey?: string;
		commitOnBlur?: boolean;
		onchange?: ((nextValue: string) => void) | undefined;
		oncommit?: ((nextValue: string) => void | Promise<void>) | undefined;
		onfocus?: (() => void) | undefined;
		onblur?: (() => void) | undefined;
	}>();

	let hostElement = $state<HTMLDivElement | null>(null);
	let editorView: EditorView | null = null;
	let applyingExternalValue = false;

	const languageCompartment = new Compartment();
	const editableCompartment = new Compartment();
	const placeholderCompartment = new Compartment();

	const resolveLanguageExtension = (selected: CodeLanguage): Extension => {
		if (selected === 'javascript') {
			return javascript();
		}
		if (selected === 'css') {
			return css();
		}
		return [];
	};

	const resolvePlaceholderExtension = (text: string): Extension => {
		const normalized = text.trim();
		if (normalized.length === 0) {
			return [];
		}
		return codeMirrorPlaceholder(normalized);
	};

	const saveShortcutTriggered = (event: KeyboardEvent): boolean =>
		!readonly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';

	const commitCurrentValue = (options: { keepFocus?: boolean } = {}): void => {
		const view = editorView;
		if (!view) {
			return;
		}
		const commitResult = oncommit?.(view.state.doc.toString());
		if (!options.keepFocus) {
			return;
		}

		const refocusIfNeeded = (): void => {
			if (editorView !== view || view.hasFocus) {
				return;
			}
			view.focus();
		};

		queueMicrotask(refocusIfNeeded);
		void Promise.resolve(commitResult).finally(() => {
			queueMicrotask(refocusIfNeeded);
		});
	};

	const interactionHandlers = EditorView.domEventHandlers({
		focus: () => {
			onfocus?.();
			return false;
		},
		keydown: (event) => {
			if (saveShortcutTriggered(event)) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				commitCurrentValue({ keepFocus: true });
				return true;
			}
			return false;
		},
		blur: () => {
			if (commitOnBlur && !readonly) {
				commitCurrentValue();
			}
			onblur?.();
			return false;
		}
	});

	const changeListener = EditorView.updateListener.of((update) => {
		if (!update.docChanged || applyingExternalValue) {
			return;
		}
		const nextValue = update.state.doc.toString();
		if (nextValue === value) {
			return;
		}
		onchange?.(nextValue);
	});

	const buildEditor = (host: HTMLDivElement): EditorView => {
		const state = EditorState.create({
			doc: value,
			extensions: [
				basicSetup,
				oneDark,
				interactionHandlers,
				changeListener,
				EditorView.lineWrapping,
				EditorView.theme({
					'&': {
						height: '100%',
						minHeight: 'var(--code-editor-min-height)'
					},
					'.cm-scroller': {
						fontFamily: "'Cascadia Code', 'Consolas', monospace",
						fontSize: '0.72rem',
						lineHeight: '1.35'
					}
				}),
				languageCompartment.of(resolveLanguageExtension(language)),
				editableCompartment.of(EditorView.editable.of(!readonly)),
				placeholderCompartment.of(resolvePlaceholderExtension(placeholder))
			]
		});
		return new EditorView({ state, parent: host });
	};

	const captureEditorState = (view: EditorView): void => {
		const normalizedKey = normalizePersistKey(persistKey);
		if (normalizedKey.length === 0) {
			return;
		}
		const selection = view.state.selection.main;
		persistEditorState(normalizedKey, {
			anchor: selection.anchor,
			head: selection.head,
			scrollTop: view.scrollDOM.scrollTop,
			scrollLeft: view.scrollDOM.scrollLeft,
			hadFocus: view.hasFocus
		});
	};

	const restoreEditorState = (view: EditorView): void => {
		const normalizedKey = normalizePersistKey(persistKey);
		if (normalizedKey.length === 0) {
			return;
		}
		const persisted = persistedEditorStates.get(normalizedKey);
		if (!persisted) {
			return;
		}

		const docLength = view.state.doc.length;
		const anchor = Math.max(0, Math.min(docLength, persisted.anchor));
		const head = Math.max(0, Math.min(docLength, persisted.head));
		view.dispatch({
			selection: { anchor, head }
		});

		const restoreViewport = (): void => {
			view.scrollDOM.scrollTop = persisted.scrollTop;
			view.scrollDOM.scrollLeft = persisted.scrollLeft;
			if (persisted.hadFocus) {
				view.focus();
			}
		};
		queueMicrotask(restoreViewport);
		requestAnimationFrame(restoreViewport);
	};

	$effect(() => {
		const host = hostElement;
		if (!host || editorView) {
			return;
		}

		const view = buildEditor(host);
		editorView = view;
		restoreEditorState(view);
		return () => {
			captureEditorState(view);
			view.destroy();
			if (editorView === view) {
				editorView = null;
			}
		};
	});

	$effect(() => {
		const view = editorView;
		if (!view || typeof window === 'undefined') {
			return;
		}

		const onWindowKeydown = (event: KeyboardEvent): void => {
			if (!view.hasFocus || !saveShortcutTriggered(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			commitCurrentValue({ keepFocus: true });
		};

		window.addEventListener('keydown', onWindowKeydown, true);
		return () => {
			window.removeEventListener('keydown', onWindowKeydown, true);
		};
	});

	$effect(() => {
		const view = editorView;
		if (!view) {
			return;
		}
		const currentValue = view.state.doc.toString();
		if (currentValue === value) {
			return;
		}
		const hadFocus = view.hasFocus;
		const preservedSelection = view.state.selection;
		const preservedScrollTop = view.scrollDOM.scrollTop;
		const preservedScrollLeft = view.scrollDOM.scrollLeft;
		applyingExternalValue = true;
		try {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: value
				},
				selection: preservedSelection
			});
			if (hadFocus) {
				view.focus();
			}
			view.scrollDOM.scrollTop = preservedScrollTop;
			view.scrollDOM.scrollLeft = preservedScrollLeft;
		} finally {
			applyingExternalValue = false;
		}
	});

	$effect(() => {
		const view = editorView;
		if (!view) {
			return;
		}
		view.dispatch({
			effects: languageCompartment.reconfigure(resolveLanguageExtension(language))
		});
	});

	$effect(() => {
		const view = editorView;
		if (!view) {
			return;
		}
		view.dispatch({
			effects: editableCompartment.reconfigure(EditorView.editable.of(!readonly))
		});
	});

	$effect(() => {
		const view = editorView;
		if (!view) {
			return;
		}
		view.dispatch({
			effects: placeholderCompartment.reconfigure(resolvePlaceholderExtension(placeholder))
		});
	});
	
	onMount(() => {
		console.log("CodeEditor mounted");
	});
</script>

<div
	class="code-editor"
	class:fill
	style={`--code-editor-min-height:${minHeight};`}
	bind:this={hostElement}></div>

<style>
	.code-editor {
		width: 100%;
		min-height: var(--code-editor-min-height);
		border: solid 0.06rem rgba(255, 255, 255, 0.16);
		border-radius: 0.25rem;
		overflow: hidden;
		background-color: var(--bg-color);
	}

	.code-editor.fill {
		height: 100%;
		min-height: 0;
	}

	.code-editor :global(.cm-editor) {
		height: 100%;
		min-height: var(--code-editor-min-height);
	}

	.code-editor.fill :global(.cm-editor) {
		min-height: 0;
	}

	.code-editor :global(.cm-scroller) {
		overflow: auto;
	}

	.code-editor :global(.cm-content),
	.code-editor :global(.cm-gutter) {
		padding-block: 0.35rem;
	}
</style>
