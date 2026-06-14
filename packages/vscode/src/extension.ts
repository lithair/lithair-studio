import * as vscode from "vscode";
import { openPlayground } from "./playgroundPanel";
import { newProject, runProject } from "./commands";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("lithairStudio.openPlayground", () =>
      openPlayground(context)
    ),
    vscode.commands.registerCommand("lithairStudio.newProject", () =>
      newProject()
    ),
    vscode.commands.registerCommand("lithairStudio.run", () => runProject())
  );
}

export function deactivate(): void {
  // no-op
}
