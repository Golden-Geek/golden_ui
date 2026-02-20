import CheckboxProperty from "./properties/CheckboxProperty.svelte";
import ColorPickerProperty from "./properties/ColorPickerProperty.svelte";
import DropdownProperty from "./properties/DropdownProperty.svelte";
import NumberProperty from "./properties/NumberProperty.svelte";
import TextEditorProperty from "./properties/TextEditorProperty.svelte";
import TextInputProperty from "./properties/TextInputProperty.svelte";

export enum Menu {
    Node = "Node",
    Preferences = "Preferences"
};

export const propertiesInspectorClass = {
    int : { component: NumberProperty },
    string : { component: TextInputProperty },
    float : { component: NumberProperty },
    boolean : { component: CheckboxProperty },
    color : { component: ColorPickerProperty },
    enum : { component: DropdownProperty },
    text : { component: TextEditorProperty, useFullSpace: true }
}