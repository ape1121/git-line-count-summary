import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

interface DiffStat {
	filePath: string;
	added: number;
	removed: number;
	status: string;
}

class LineChangesViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.onDidReceiveMessage((msg) => {
			if (msg.command === 'openFile') {
				const uri = vscode.Uri.file(path.join(this.workspaceRoot, msg.filePath));
				vscode.window.showTextDocument(uri);
			}
		});
		this.refresh();
	}

	refresh(): void {
		if (!this._view) {
			return;
		}
		const stats = this.getDiffStats();
		this._view.webview.html = this.getHtml(stats);
	}

	private getCodiconsUri(): string {
		if (!this._view) { return ''; }
		const codiconsUri = this._view.webview.asWebviewUri(
			vscode.Uri.joinPath(vscode.Uri.file(path.dirname(require.resolve('@vscode/codicons/dist/codicon.css'))), 'codicon.css')
		);
		return codiconsUri.toString();
	}

	private getFileIcon(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();
		const iconMap: Record<string, string> = {
			'.ts': 'codicon-file-code', '.tsx': 'codicon-file-code',
			'.js': 'codicon-file-code', '.jsx': 'codicon-file-code',
			'.json': 'codicon-json', '.md': 'codicon-markdown',
			'.html': 'codicon-file-code', '.css': 'codicon-file-code',
			'.scss': 'codicon-file-code', '.less': 'codicon-file-code',
			'.py': 'codicon-file-code', '.rb': 'codicon-file-code',
			'.go': 'codicon-file-code', '.rs': 'codicon-file-code',
			'.java': 'codicon-file-code', '.c': 'codicon-file-code',
			'.cpp': 'codicon-file-code', '.h': 'codicon-file-code',
			'.sh': 'codicon-terminal', '.bash': 'codicon-terminal',
			'.yml': 'codicon-file-code', '.yaml': 'codicon-file-code',
			'.xml': 'codicon-file-code', '.svg': 'codicon-file-media',
			'.png': 'codicon-file-media', '.jpg': 'codicon-file-media',
			'.gif': 'codicon-file-media', '.ico': 'codicon-file-media',
			'.txt': 'codicon-file', '.log': 'codicon-file',
			'.gitignore': 'codicon-file', '.env': 'codicon-file',
		};
		return iconMap[ext] ?? 'codicon-file';
	}

	private getHtml(stats: DiffStat[]): string {
		let codiconsHref = '';
		try { codiconsHref = this.getCodiconsUri(); } catch { /* fallback without icons */ }

		const rows = stats.map((s) => {
			const fileName = path.basename(s.filePath);
			const dir = path.dirname(s.filePath);
			const dirDisplay = dir === '.' ? '' : dir + '/';
			const escapedPath = s.filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
			const iconClass = this.getFileIcon(s.filePath);
			return `<div class="row" onclick="openFile('${escapedPath}')" title="${s.filePath}">
				<span class="codicon ${iconClass} file-icon"></span>
				<span class="name"><span class="dir">${dirDisplay}</span>${fileName}</span>
				<span class="stats">
					<span class="added">+${s.added}</span>
					<span class="removed">-${s.removed}</span>
				</span>
				<span class="status">${s.status}</span>
			</div>`;
		}).join('');

		return `<!DOCTYPE html>
<html>
<head>
${codiconsHref ? `<link rel="stylesheet" href="${codiconsHref}">` : ''}
<style>
	body {
		margin: 0;
		padding: 4px 0;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
	}
	.row {
		display: flex;
		align-items: center;
		padding: 3px 12px;
		cursor: pointer;
		gap: 8px;
	}
	.file-icon {
		flex-shrink: 0;
		font-size: 16px;
		opacity: 0.8;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dir {
		opacity: 0.6;
	}
	.stats {
		flex-shrink: 0;
		font-weight: bold;
		white-space: nowrap;
	}
	.added {
		color: #3fb950;
		margin-right: 6px;
	}
	.removed {
		color: #f85149;
	}
	.status {
		flex-shrink: 0;
		font-weight: bold;
		opacity: 0.8;
		min-width: 14px;
		text-align: center;
	}
	.empty {
		padding: 12px;
		opacity: 0.6;
		text-align: center;
	}
</style>
</head>
<body>
	${rows.length > 0 ? rows : '<div class="empty">No changes</div>'}
	<script>
		const vscode = acquireVsCodeApi();
		function openFile(filePath) {
			vscode.postMessage({ command: 'openFile', filePath });
		}
	</script>
</body>
</html>`;
	}

	private getDiffStats(): DiffStat[] {
		try {
			const fileMap = new Map<string, DiffStat>();
			const statusMap = this.getStatusMap();

			// Staged changes
			this.parseNumstat(this.runGit('diff --cached --numstat'), statusMap, fileMap);
			// Unstaged changes
			this.parseNumstat(this.runGit('diff --numstat'), statusMap, fileMap);

			// Untracked files
			const untracked = this.runGit('ls-files --others --exclude-standard');
			if (untracked.trim()) {
				for (const line of untracked.trim().split('\n')) {
					const filePath = line.trim();
					if (filePath && !fileMap.has(filePath)) {
						let lineCount = 0;
						try {
							const fullPath = path.join(this.workspaceRoot, filePath);
							const content = execSync(`cat "${fullPath}"`, { encoding: 'utf8', timeout: 5000 });
							lineCount = content.split('\n').length;
							if (content.endsWith('\n')) { lineCount--; }
						} catch { /* ignore */ }
						fileMap.set(filePath, { filePath, added: lineCount, removed: 0, status: 'U' });
					}
				}
			}

			return Array.from(fileMap.values());
		} catch {
			return [];
		}
	}

	private getStatusMap(): Map<string, string> {
		const statusMap = new Map<string, string>();
		const parseStatus = (output: string) => {
			if (!output.trim()) { return; }
			for (const line of output.trim().split('\n')) {
				const parts = line.split('\t');
				if (parts.length >= 2) {
					statusMap.set(parts[1], parts[0].charAt(0));
				}
			}
		};
		parseStatus(this.runGit('diff --cached --name-status'));
		parseStatus(this.runGit('diff --name-status'));
		return statusMap;
	}

	private parseNumstat(output: string, statusMap: Map<string, string>, map: Map<string, DiffStat>): void {
		if (!output.trim()) { return; }
		for (const line of output.trim().split('\n')) {
			const parts = line.split('\t');
			if (parts.length >= 3) {
				const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
				const removed = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
				const filePath = parts[2];
				const existing = map.get(filePath);
				if (existing) {
					existing.added += added;
					existing.removed += removed;
				} else {
					map.set(filePath, { filePath, added, removed, status: statusMap.get(filePath) ?? 'M' });
				}
			}
		}
	}

	private runGit(args: string): string {
		try {
			return execSync(`git -C "${this.workspaceRoot}" ${args}`, { encoding: 'utf8', timeout: 10000 });
		} catch {
			return '';
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) { return; }

	const provider = new LineChangesViewProvider(workspaceRoot);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('gitLineCountSummary', provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gitLineCountSummary.refresh', () => provider.refresh())
	);

	// Auto-refresh on file changes
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	const debounceRefresh = debounce(() => provider.refresh(), 1000);
	watcher.onDidChange(debounceRefresh);
	watcher.onDidCreate(debounceRefresh);
	watcher.onDidDelete(debounceRefresh);
	context.subscriptions.push(watcher);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => debounceRefresh())
	);
}

function debounce(fn: () => void, ms: number): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		if (timer) { clearTimeout(timer); }
		timer = setTimeout(fn, ms);
	};
}

export function deactivate() {}
