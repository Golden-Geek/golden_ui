import CheckboxEditor from "./parameters/CheckboxEditor.svelte";
import ColorPickerEditor from "./parameters/ColorPickerEditor.svelte";
import DropdownEditor from "./parameters/DropdownEditor.svelte";
import NumberEditor from "./parameters/NumberEditor.svelte";
import TextInputEditor from "./parameters/TextInputEditor.svelte";
import TriggerEditor from "./parameters/TriggerEditor.svelte";
import ReferenceEditor from "./parameters/ReferenceEditor.svelte";
import MultiNumberEditor from "./parameters/MultiNumberEditor.svelte";
import FilePathEditor from "./parameters/FilePathEditor.svelte";

export const propertiesInspectorClass: Record<string, { component: any; useFullSpace?: boolean }> = {
    "trigger": { component: TriggerEditor },
    "int": { component: NumberEditor },
    "str": { component: TextInputEditor },
    "file": { component: FilePathEditor },
    "float": { component: NumberEditor },
    "bool": { component: CheckboxEditor },
    "color": { component: ColorPickerEditor },
    "enum": { component: DropdownEditor },
    "vec2": { component: MultiNumberEditor },
    "vec3": { component: MultiNumberEditor },
    "reference": { component: ReferenceEditor },
}
