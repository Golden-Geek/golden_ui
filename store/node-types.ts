import type { UiNodeDto } from "../types";
import nodeAddIcon from "../style/icons/node/add.svg";
import folderIcon from "../style/icons/node/folder.svg";
import nodeManagerIcon from "../style/icons/node/manager.svg";
import parameterBoolIcon from "../style/icons/parameter/bool.svg";
import parameterColorIcon from "../style/icons/parameter/color.svg";
import parameterEnumIcon from "../style/icons/parameter/enum.svg";
import parameterFloatIcon from "../style/icons/parameter/float.svg";
import parameterIntIcon from "../style/icons/parameter/int.svg";
import parameterStringIcon from "../style/icons/parameter/string.svg";
import parameterTriggerIcon from "../style/icons/parameter/trigger.svg";
import parameterVec2Icon from "../style/icons/parameter/vec2.svg";
import parameterVec3Icon from "../style/icons/parameter/vec3.svg";
import parameterReferenceIcon from "../style/icons/parameter/reference.svg";

const DEFAULT_FALLBACK_ICON = nodeAddIcon;
const DEFAULT_MANAGER_ICON = nodeManagerIcon;
const DEFAULT_PARAMETER_ICON = parameterTriggerIcon;

export interface NodeIconSet {
    manager?: string;
    parameter?: string;
    fallback?: string;
    nodeTypes?: Record<string, string>;
    parameterKinds?: Record<string, string>;
}

type ResolvedNodeIconSet = {
    manager: string;
    parameter: string;
    fallback: string;
    nodeTypes: Record<string, string>;
    parameterKinds: Record<string, string>;
};

const defaultNodeIcons: ResolvedNodeIconSet = {
    manager: DEFAULT_MANAGER_ICON,
    parameter: DEFAULT_PARAMETER_ICON,
    fallback: DEFAULT_FALLBACK_ICON,
    nodeTypes: {
        add: nodeAddIcon,
        folder: folderIcon,
    },
    parameterKinds: {
        bool: parameterBoolIcon,
        color: parameterColorIcon,
        enum: parameterEnumIcon,
        float: parameterFloatIcon,
        int: parameterIntIcon,
        str: parameterStringIcon,
        trigger: parameterTriggerIcon,
        vec2: parameterVec2Icon,
        vec3: parameterVec3Icon,
        reference: parameterReferenceIcon,
    },
};

const resolveNodeIcons = (overrides?: NodeIconSet): ResolvedNodeIconSet => ({
    manager: overrides?.manager ?? defaultNodeIcons.manager,
    parameter: overrides?.parameter ?? defaultNodeIcons.parameter,
    fallback: overrides?.fallback ?? defaultNodeIcons.fallback,
    nodeTypes: {
        ...defaultNodeIcons.nodeTypes,
        ...(overrides?.nodeTypes ?? {}),
    },
    parameterKinds: {
        ...defaultNodeIcons.parameterKinds,
        ...(overrides?.parameterKinds ?? {}),
    },
});

let activeNodeIcons: ResolvedNodeIconSet = resolveNodeIcons();

export const configureNodeIcons = (overrides?: NodeIconSet): void => {
    activeNodeIcons = resolveNodeIcons(overrides);
};

export const getIconURLForNode = (node: UiNodeDto | null): string => {
    if (!node) {
        return activeNodeIcons.fallback;
    }

    const isManager = (node.creatable_user_items?.length ?? 0) > 0;

    if (node.data.kind === "parameter") {
        const parameterKind = node.data.param.value.kind;
        return (
            activeNodeIcons.parameterKinds[parameterKind] ??
            activeNodeIcons.parameter ??
            activeNodeIcons.fallback
        );
    }

    let result = activeNodeIcons.nodeTypes[node.node_type] ?? activeNodeIcons.nodeTypes[node.user_item_kind];
    if (!result) {
        // Fallback to manager icon if it's a node type we don't have a specific icon for, but it has creatable items (i.e. it's a manager of some kind)
        if (isManager) {
            result = activeNodeIcons.manager;
        }
    }
    return result ?? activeNodeIcons.fallback;
};


// Utility function to generate rounded box with the name inside. the box is white transparent and text is dark grey
export const generateIconWithText = (text: string, color?: string): string => {
    if (typeof document === "undefined") {
        return activeNodeIcons.fallback;
    }

    const canvas = document.createElement("canvas");
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return activeNodeIcons.fallback;
    }

    // Draw rounded rectangle
    const radius = 12;
    ctx.fillStyle = color ?? "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.fill();

    // Draw text
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2);

    return canvas.toDataURL();
};