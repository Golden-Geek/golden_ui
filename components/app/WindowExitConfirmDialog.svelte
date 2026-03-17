<script lang="ts">
	import { tick } from 'svelte';
	import {
		cancelWindowExit,
		confirmWindowExitDiscard,
		confirmWindowExitSave,
		getWindowExitProjectName,
		windowExitState
	} from '../../store/window-exit.svelte';

	let saveButtonElement: HTMLButtonElement | null = $state(null);
	const dialogTitleId = 'gc-window-exit-title';
	const projectName = $derived(getWindowExitProjectName());

	const handleKeydown = (event: KeyboardEvent): void => {
		if (!windowExitState.open || windowExitState.busy) {
			return;
		}
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		const normalizedKey = event.key.trim().toLowerCase();
		switch (normalizedKey) {
			case 's':
			case 'enter':
				event.preventDefault();
				event.stopPropagation();
				void confirmWindowExitSave();
				return;
			case 'd':
			case 'backspace':
				event.preventDefault();
				event.stopPropagation();
				void confirmWindowExitDiscard();
				return;
			case 'c':
			case 'escape':
				event.preventDefault();
				event.stopPropagation();
				cancelWindowExit();
				return;
		}
	};

	$effect(() => {
		if (!windowExitState.open || typeof window === 'undefined') {
			return;
		}

		window.addEventListener('keydown', handleKeydown, true);
		return () => {
			window.removeEventListener('keydown', handleKeydown, true);
		};
	});

	$effect(() => {
		if (!windowExitState.open) {
			return;
		}

		void tick().then(() => {
			saveButtonElement?.focus();
		});
	});
</script>

{#if windowExitState.open}
	<div class="gc-window-exit-overlay">
		<div
			class="gc-window-exit-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby={dialogTitleId}>
			<div class="gc-window-exit-copy">
				<h2 id={dialogTitleId}>Save changes before exiting?</h2>
				<p>
					"{projectName}" has unsaved changes. Save before closing the app, discard the changes, or
					stay here.
				</p>
				{#if windowExitState.errorMessage}
					<p class="save-error" role="alert" aria-live="assertive">
						{windowExitState.errorMessage}
					</p>
				{/if}
			</div>
			<div class="gc-window-exit-actions">
				<button
					bind:this={saveButtonElement}
					type="button"
					class="is-primary"
					disabled={windowExitState.busy}
					onclick={() => void confirmWindowExitSave()}>
					<span>Save</span>
					<span class="shortcut">S / Enter</span>
				</button>
				<button
					type="button"
					class="is-danger"
					disabled={windowExitState.busy}
					onclick={() => void confirmWindowExitDiscard()}>
					<span>Discard</span>
					<span class="shortcut">D / Backspace</span>
				</button>
				<button type="button" disabled={windowExitState.busy} onclick={cancelWindowExit}>
					<span>Cancel</span>
					<span class="shortcut">C / Escape</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.gc-window-exit-overlay {
		position: fixed;
		inset: 0;
		z-index: 120;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		background:
			linear-gradient(180deg, rgb(9 14 21 / 52%), rgb(9 14 21 / 76%)),
			radial-gradient(circle at top, rgb(93 167 255 / 16%), transparent 50%);
		backdrop-filter: blur(0.45rem);
	}

	.gc-window-exit-dialog {
		inline-size: min(30rem, calc(100vw - 2.5rem));
		display: grid;
		gap: 1.25rem;
		padding: 1.3rem;
		border-radius: 1rem;
		background: linear-gradient(180deg, rgb(24 30 39 / 96%), rgb(14 19 27 / 98%));
		border: 0.06rem solid rgb(from var(--gc-color-text) r g b / 16%);
		box-shadow:
			0 1.4rem 3rem rgb(0 0 0 / 34%),
			0 0 0 0.06rem rgb(from var(--gc-color-focus) r g b / 10%);
	}

	.gc-window-exit-copy {
		display: grid;
		gap: 0.55rem;
	}

	.gc-window-exit-copy h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: rgb(from var(--gc-color-text) r g b / 96%);
	}

	.gc-window-exit-copy p {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
		color: rgb(from var(--gc-color-text) r g b / 72%);
	}

	.save-error {
		padding: 0.7rem 0.8rem;
		border-radius: 0.7rem;
		border: 0.06rem solid rgb(214 120 96 / 38%);
		background: rgb(125 49 35 / 18%);
		color: rgb(255 196 178);
	}

	.gc-window-exit-actions {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
	}

	.gc-window-exit-actions button {
		display: grid;
		gap: 0.2rem;
		align-content: center;
		justify-items: start;
		min-block-size: 4rem;
		padding: 0.8rem 0.95rem;
		border-radius: 0.85rem;
		border: 0.06rem solid rgb(from var(--gc-color-text) r g b / 14%);
		background: rgb(from var(--gc-color-text) r g b / 7%);
		color: rgb(from var(--gc-color-text) r g b / 92%);
		text-align: left;
		transition:
			transform 0.16s ease,
			border-color 0.16s ease,
			background-color 0.16s ease,
			opacity 0.16s ease;
	}

	.gc-window-exit-actions button:hover:not(:disabled),
	.gc-window-exit-actions button:focus-visible:not(:disabled) {
		transform: translateY(-0.06rem);
		border-color: rgb(from var(--gc-color-focus) r g b / 42%);
		background: rgb(from var(--gc-color-text) r g b / 11%);
	}

	.gc-window-exit-actions button.is-primary {
		background: linear-gradient(180deg, rgb(78 133 214 / 58%), rgb(54 97 164 / 72%));
		border-color: rgb(121 175 255 / 44%);
	}

	.gc-window-exit-actions button.is-danger {
		background: linear-gradient(180deg, rgb(134 76 62 / 42%), rgb(109 57 45 / 56%));
		border-color: rgb(214 120 96 / 28%);
	}

	.gc-window-exit-actions button:disabled {
		opacity: 0.62;
		transform: none;
		cursor: default;
	}

	.shortcut {
		font-size: 0.68rem;
		letter-spacing: 0.04em;
		color: rgb(from var(--gc-color-text) r g b / 62%);
	}

	@media (max-width: 44rem) {
		.gc-window-exit-actions {
			grid-template-columns: 1fr;
		}
	}
</style>
