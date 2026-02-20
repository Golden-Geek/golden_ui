<script lang="ts">
    import { mount, onMount, unmount } from "svelte";
    import {
        DockviewComponent,
        type AddPanelOptions,
        type CreateComponentOptions,
        type DockviewGroupPanel,
        type DockviewIDisposable,
        type GroupPanelPartInitParameters,
        type IContentRenderer,
        type IGroupHeaderProps,
        type IHeaderActionsRenderer,
        type PanelUpdateEvent,
    } from "dockview-core";

    import "dockview-core/dist/styles/dockview.css";
    import { goldenDockviewTheme } from "../../dockview/goldenDockviewTheme";
    import { createGoldenTabRenderer } from "../../dockview/createGoldenTabRenderer";

    import type {
        PanelApi,
        PanelDefinition,
        PanelExports,
        PanelSpawnPosition,
        PanelSpawnRequest,
        PanelState,
        UserPanelDefinition,
        UserPanelDefinitionMap,
    } from "$lib/golden_ui/dockview/panel-types";
    import {
        configureNodeIcons,
        type NodeIconSet,
    } from "../../store/node-types";

    import MainViewPanel from "../panels/MainViewPanel.svelte";
    import UnknownPanel from "../panels/UnknownPanel.svelte";
    import Outliner from "../panels/outliner/OutlinerPanel.svelte";
    import InspectorPanel from "../panels/inspector/InspectorPanel.svelte";

    const props = $props<{
        userPanels?: UserPanelDefinitionMap;
        initialPanels?: PanelSpawnRequest[];
        nodeIcons?: NodeIconSet;
    }>();

    $effect(() => {
        configureNodeIcons(props.nodeIcons);
    });

    type MountedPanel = PanelExports & Record<string, unknown>;

    const goldenPanelDefinitions: Record<string, PanelDefinition> = {
        inspector: {
            panelType: "inspector",
            title: "Inspector",
            component: InspectorPanel,
            origin: "golden",
        },
        mainView: {
            panelType: "mainView",
            title: "Main View",
            component: MainViewPanel,
            defaultParams: {
                mode: "graph",
                nodeCount: 3,
            },
            origin: "golden",
        },

        outliner: {
            panelType: "outliner",
            title: "Outliner",
            component: Outliner,
            origin: "golden",
        },
    };

    const formatPanelTypeTitle = (panelType: string): string =>
        panelType
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^./, (match) => match.toUpperCase());

    const isUserPanelDefinition = (
        value: UserPanelDefinitionMap[string],
    ): value is UserPanelDefinition =>
        typeof value === "object" && value !== null && "component" in value;

    const normalizeUserPanels = (
        entries: UserPanelDefinitionMap | undefined,
    ): Record<string, PanelDefinition> => {
        if (!entries) {
            return {};
        }

        return Object.entries(entries).reduce<Record<string, PanelDefinition>>(
            (accumulator, [panelType, entry]) => {
                if (isUserPanelDefinition(entry)) {
                    accumulator[panelType] = {
                        panelType,
                        title: entry.title ?? formatPanelTypeTitle(panelType),
                        component: entry.component,
                        description: entry.description,
                        defaultParams: entry.defaultParams,
                        renderPolicy: entry.renderPolicy,
                        origin: "user",
                    };
                    return accumulator;
                }

                accumulator[panelType] = {
                    panelType,
                    title: formatPanelTypeTitle(panelType),
                    component: entry,
                    origin: "user",
                };
                return accumulator;
            },
            {},
        );
    };

    const panelDefinitions: Record<string, PanelDefinition> = {
        ...goldenPanelDefinitions,
        ...normalizeUserPanels(props.userPanels),
    };
    const availablePanelDefinitions = Object.values(panelDefinitions).sort(
        (first, second) => first.title.localeCompare(second.title),
    );

    let containerElement: HTMLDivElement | undefined;
    let dockview: DockviewComponent | undefined;

    const panelInstanceCounters = new Map<string, number>();

    const nextPanelId = (panelType: string): string => {
        let nextIndex = panelInstanceCounters.get(panelType) ?? 1;
        let panelId = `${panelType}-${nextIndex}`;

        while (dockview?.getPanel(panelId)) {
            nextIndex += 1;
            panelId = `${panelType}-${nextIndex}`;
        }

        panelInstanceCounters.set(panelType, nextIndex + 1);
        return panelId;
    };

    const toDockviewPosition = (
        position: PanelSpawnPosition | undefined,
    ): AddPanelOptions["position"] | undefined => {
        if (!position) {
            return undefined;
        }

        const direction = position.direction ?? "within";
        if (position.referencePanelId) {
            return {
                referencePanel: position.referencePanelId,
                direction,
            };
        }

        if (direction === "within") {
            return undefined;
        }

        return { direction };
    };

    const createPanelRenderer = (
        options: CreateComponentOptions,
    ): IContentRenderer => {
        const hostElement = document.createElement("div");
        hostElement.className = "gc-dock-panel-host";

        const panelDefinition = panelDefinitions[options.name];
        const PanelComponent = panelDefinition?.component ?? UnknownPanel;

        let mountedPanel: MountedPanel | undefined;
        let panelState: PanelState = {
            panelId: options.id,
            panelType: options.name,
            title: panelDefinition?.title ?? options.name,
            params: {},
        };

        return {
            element: hostElement,
            init: (parameters: GroupPanelPartInitParameters): void => {
                panelState = {
                    panelId: parameters.api.id,
                    panelType: options.name,
                    title:
                        parameters.title ??
                        panelDefinition?.title ??
                        options.name,
                    params: parameters.params ?? {},
                };

                const panelApi: PanelApi = {
                    setTitle: (nextTitle: string): void => {
                        parameters.api.setTitle(nextTitle);
                    },
                    close: (): void => {
                        parameters.api.close();
                    },
                };

                mountedPanel = mount(PanelComponent, {
                    target: hostElement,
                    props: {
                        panelApi,
                        ...panelState,
                    },
                }) as MountedPanel;
            },
            update: (event: PanelUpdateEvent): void => {
                panelState = {
                    ...panelState,
                    params: {
                        ...panelState.params,
                        ...(event.params ?? {}),
                    },
                };

                mountedPanel?.setPanelState(panelState);
            },
            dispose: (): void => {
                if (!mountedPanel) {
                    return;
                }

                void unmount(mountedPanel);
                mountedPanel = undefined;
            },
        };
    };

    const addPanel = (
        request: PanelSpawnRequest,
        overridePosition?: AddPanelOptions["position"],
    ): string | null => {
        if (!dockview) {
            return null;
        }

        const panelDefinition = panelDefinitions[request.panelType];
        if (!panelDefinition) {
            console.error(`Panel "${request.panelType}" is not registered.`);
            return null;
        }

        const panelId = request.panelId ?? nextPanelId(request.panelType);
        const options: AddPanelOptions = {
            id: panelId,
            component: request.panelType,
            title: request.title ?? panelDefinition.title,
            params: {
                ...(panelDefinition.defaultParams ?? {}),
                ...(request.params ?? {}),
            },
            renderer: request.renderPolicy ?? panelDefinition.renderPolicy,
            inactive: request.inactive,
            initialWidth: request.initialWidth,
            initialHeight: request.initialHeight,
            minimumWidth: request.minimumWidth,
            maximumWidth: request.maximumWidth,
            minimumHeight: request.minimumHeight,
            maximumHeight: request.maximumHeight,
        };

        const position =
            overridePosition ?? toDockviewPosition(request.position);
        if (position) {
            options.position = position;
        }

        dockview.addPanel(options);
        return panelId;
    };

    const createGroupAddRenderer = (
        group: DockviewGroupPanel,
    ): IHeaderActionsRenderer => {
        const element = document.createElement("div");
        element.className = "gc-group-panel-add";

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "gc-group-panel-add-trigger";
        // trigger.textContent = "+";
        trigger.setAttribute("aria-label", "Add panel in this group");
        trigger.setAttribute("title", "Add panel");
        trigger.disabled = availablePanelDefinitions.length === 0;

        const menu = document.createElement("div");
        menu.className = "gc-group-panel-add-menu";
        menu.hidden = true;

        const listenerDisposables: DockviewIDisposable[] = [];
        const dockviewDisposables: DockviewIDisposable[] = [];
        let hasGlobalListeners = false;

        const positionMenu = (): void => {
            if (menu.hidden) {
                return;
            }

            const viewportPadding = 8;
            menu.style.transform = "";

            const rect = menu.getBoundingClientRect();
            let shiftX = 0;
            const maxRight = window.innerWidth - viewportPadding;

            if (rect.right > maxRight) {
                shiftX -= rect.right - maxRight;
            }

            if (rect.left + shiftX < viewportPadding) {
                shiftX += viewportPadding - (rect.left + shiftX);
            }

            menu.style.transform = `translateX(${Math.round(shiftX)}px)`;
        };

        const closeMenu = (): void => {
            menu.hidden = true;
            element.classList.remove("is-open");
            menu.style.transform = "";
            if (hasGlobalListeners) {
                document.removeEventListener(
                    "pointerdown",
                    onGlobalPointerDown,
                );
                window.removeEventListener("resize", onViewportResize);
                hasGlobalListeners = false;
            }
        };

        const openMenu = (): void => {
            if (availablePanelDefinitions.length === 0) {
                return;
            }

            if (!hasGlobalListeners) {
                document.addEventListener("pointerdown", onGlobalPointerDown);
                window.addEventListener("resize", onViewportResize);
                hasGlobalListeners = true;
            }

            menu.hidden = false;
            element.classList.add("is-open");
            requestAnimationFrame(positionMenu);
        };

        const toggleMenu = (): void => {
            if (menu.hidden) {
                openMenu();
                return;
            }

            closeMenu();
        };

        const stopMouseDown = (event: MouseEvent): void => {
            event.preventDefault();
            event.stopPropagation();
        };

        const onTriggerClick = (event: MouseEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            toggleMenu();
        };

        const onGlobalPointerDown = (event: PointerEvent): void => {
            if (!(event.target instanceof Node)) {
                closeMenu();
                return;
            }

            if (!element.contains(event.target)) {
                closeMenu();
            }
        };

        const onViewportResize = (): void => {
            positionMenu();
        };

        trigger.addEventListener("click", onTriggerClick);
        trigger.addEventListener("mousedown", stopMouseDown);
        menu.addEventListener("mousedown", stopMouseDown);

        listenerDisposables.push(
            {
                dispose: () => {
                    trigger.removeEventListener("click", onTriggerClick);
                    trigger.removeEventListener("mousedown", stopMouseDown);
                },
            },
            {
                dispose: () => {
                    menu.removeEventListener("mousedown", stopMouseDown);
                },
            },
        );

        for (const panelDefinition of availablePanelDefinitions) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "gc-group-panel-add-item";
            item.textContent = panelDefinition.title;

            const onItemClick = (event: MouseEvent): void => {
                event.preventDefault();
                event.stopPropagation();
                addPanel(
                    { panelType: panelDefinition.panelType },
                    { referenceGroup: group, direction: "within" },
                );
                closeMenu();
            };

            item.addEventListener("click", onItemClick);
            item.addEventListener("mousedown", stopMouseDown);
            listenerDisposables.push({
                dispose: () => {
                    item.removeEventListener("click", onItemClick);
                    item.removeEventListener("mousedown", stopMouseDown);
                },
            });

            menu.append(item);
        }

        element.append(trigger, menu);

        return {
            element,
            init: (parameters: IGroupHeaderProps): void => {
                dockviewDisposables.push(
                    parameters.group.model.onDidActivePanelChange(() => {
                        closeMenu();
                    }),
                );
            },
            dispose: (): void => {
                closeMenu();
                for (const disposable of listenerDisposables) {
                    disposable.dispose();
                }
                for (const disposable of dockviewDisposables) {
                    disposable.dispose();
                }
            },
        };
    };

    const createDefaultInitialPanels = (): PanelSpawnRequest[] => {
        if (!containerElement) {
            return [];
        }

        const rootFontSizePx =
            Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
            ) || 16;
        const remToPx = (value: number): number =>
            Math.round(value * rootFontSizePx);

        const containerWidth = containerElement.clientWidth;
        const explorerTargetWidth = Math.round(containerWidth * 0.24);
        const explorerMinWidth = remToPx(14);
        const explorerMaxWidth = Math.round(containerWidth * 0.45);
        const clampedExplorerWidth = Math.min(
            Math.max(explorerTargetWidth, explorerMinWidth),
            explorerMaxWidth,
        );
        const mainInitialWidth = Math.max(
            containerWidth - clampedExplorerWidth,
            remToPx(18),
        );

        return [
            {
                panelId: "outliner",
                panelType: "outliner",
                initialWidth: remToPx(10),
                maximumWidth: remToPx(30),
            },
            {
                panelId: "panel-main",
                panelType: "mainView",
                initialWidth: mainInitialWidth,
                position: {
                    referencePanelId: "outliner",
                    direction: "right",
                },
            },
            {
                panelId: "inspector",
                panelType: "inspector",
                position: {
                    referencePanelId: "panel-main",
                    direction: "right",
                },
            },
        ];
    };

    onMount(() => {
        if (!containerElement) {
            return;
        }

        dockview = new DockviewComponent(containerElement, {
            createComponent: createPanelRenderer,
            defaultTabComponent: "golden-tab",
            createTabComponent: (options) =>
                options.name === "golden-tab"
                    ? createGoldenTabRenderer()
                    : undefined,
            createLeftHeaderActionComponent: (group) =>
                createGroupAddRenderer(group),
            theme: goldenDockviewTheme,
        });

        const initialPanels =
            props.initialPanels ?? createDefaultInitialPanels();
        for (const panel of initialPanels) {
            addPanel(panel);
        }

        return () => {
            dockview?.dispose();
            dockview = undefined;
        };
    });
</script>

<div class="gc-content">
    <div bind:this={containerElement} class="gc-dockview"></div>
</div>

<style>
    :global(.gc-group-panel-add) {
        position: relative;
        display: flex;
        align-items: center;
        block-size: 100%;
    }

    :global(.gc-group-panel-add-trigger) {
        inline-size: 1.4rem;
        block-size: 1.4rem;
        border: 0.0625rem solid
            color-mix(in srgb, var(--gc-color-panel-outline) 88%, white 12%);
        border-radius: 0.35rem;
        background: color-mix(in srgb, var(--gc-color-panel-row) 78%, black);
        color: inherit;
        font-size: 0.92rem;
        line-height: 1;
        cursor: pointer;
        padding: 0;
    }

    :global(.gc-group-panel-add-trigger:disabled) {
        cursor: default;
        opacity: 0.45;
    }

    :global(.gc-group-panel-add-menu) {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: calc(100% + 0.3rem);
        min-inline-size: 9rem;
        max-inline-size: min(14rem, calc(100vw - 1rem));
        display: grid;
        gap: 0.2rem;
        padding: 0.3rem;
        border-radius: 0.45rem;
        z-index: 20;
        border: 0.0625rem solid
            color-mix(in srgb, var(--gc-color-focus) 45%, transparent);
        background: color-mix(in srgb, var(--gc-color-header) 84%, transparent);
        backdrop-filter: blur(0.3rem);
        box-shadow: 0 0.4rem 1rem color-mix(in srgb, black 60%, transparent);
    }

    :global(.gc-group-panel-add-menu[hidden]) {
        display: none;
    }

    :global(.gc-group-panel-add-item) {
        inline-size: 100%;
        text-align: start;
        padding: 0.35rem 0.5rem;
        border: 0;
        border-radius: 0.3rem;
        color: inherit;
        cursor: pointer;
        font-size: 0.76rem;
        background: color-mix(in srgb, var(--gc-color-panel-row) 76%, black);
    }

    :global(.gc-group-panel-add-item:hover) {
        background: color-mix(in srgb, var(--gc-color-focus-muted) 74%, black);
    }
</style>
