'use client';
import type { ComponentProps } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

export function ResizablePanelGroup(props: ComponentProps<typeof Group>) {
 return <Group data-slot="resizable-panel-group" {...props}/>;
}
export function ResizablePanel(props: ComponentProps<typeof Panel>) {
 return <Panel data-slot="resizable-panel" {...props}/>;
}
/** An invisible, keyboard-focusable boundary; deliberately no grip or handle bar. */
export function ResizableHandle(props: ComponentProps<typeof Separator>) {
 return <Separator data-slot="resizable-handle" {...props}/>;
}
