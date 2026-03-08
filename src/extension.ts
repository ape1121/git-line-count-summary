import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

interface DiffStat {
	filePath: string;
	added: number;
	removed: number;
	status: string;
}

const FILE_ICON_MAP: Record<string, { codicon: string; color: string }> = {
	'.ts':    { codicon: 'codicon-file-code', color: '#3178c6' },
	'.tsx':   { codicon: 'codicon-file-code', color: '#3178c6' },
	'.js':    { codicon: 'codicon-file-code', color: '#f1e05a' },
	'.jsx':   { codicon: 'codicon-file-code', color: '#f1e05a' },
	'.json':  { codicon: 'codicon-json',      color: '#cb8622' },
	'.py':    { codicon: 'codicon-file-code', color: '#3572a5' },
	'.cs':    { codicon: 'codicon-file-code', color: '#178600' },
	'.c':     { codicon: 'codicon-file-code', color: '#555555' },
	'.cpp':   { codicon: 'codicon-file-code', color: '#f34b7d' },
	'.h':     { codicon: 'codicon-file-code', color: '#555555' },
	'.java':  { codicon: 'codicon-file-code', color: '#b07219' },
	'.go':    { codicon: 'codicon-file-code', color: '#00add8' },
	'.rs':    { codicon: 'codicon-file-code', color: '#dea584' },
	'.rb':    { codicon: 'codicon-file-code', color: '#701516' },
	'.php':   { codicon: 'codicon-file-code', color: '#4f5d95' },
	'.swift': { codicon: 'codicon-file-code', color: '#f05138' },
	'.kt':    { codicon: 'codicon-file-code', color: '#a97bff' },
	'.html':  { codicon: 'codicon-file-code', color: '#e34c26' },
	'.css':   { codicon: 'codicon-file-code', color: '#563d7c' },
	'.scss':  { codicon: 'codicon-file-code', color: '#c6538c' },
	'.md':    { codicon: 'codicon-markdown',  color: '#083fa1' },
	'.yml':   { codicon: 'codicon-file-code', color: '#cb171e' },
	'.yaml':  { codicon: 'codicon-file-code', color: '#cb171e' },
	'.xml':   { codicon: 'codicon-file-code', color: '#0060ac' },
	'.sh':    { codicon: 'codicon-terminal',  color: '#89e051' },
	'.bash':  { codicon: 'codicon-terminal',  color: '#89e051' },
	'.sql':   { codicon: 'codicon-database',  color: '#e38c00' },
	'.svg':   { codicon: 'codicon-file-media', color: '#ff9900' },
	'.png':   { codicon: 'codicon-file-media', color: '#a074c4' },
	'.jpg':   { codicon: 'codicon-file-media', color: '#a074c4' },
	'.gif':   { codicon: 'codicon-file-media', color: '#a074c4' },
	'.txt':   { codicon: 'codicon-file',      color: '#8a8a8a' },
	'.log':   { codicon: 'codicon-file',      color: '#8a8a8a' },
	'.env':   { codicon: 'codicon-file',      color: '#8a8a8a' },
};

const DEFAULT_ICON = { codicon: 'codicon-file', color: '#8a8a8a' };

const STATUS_COLORS: Record<string, string> = {
	'D': '#b73d36',
	'U': '#349641',
	'A': '#3fb950',
	'M': '#cca700',
	'R': '#3b82f6',
};

type SortKey = 'added' | 'removed' | 'status' | 'name';

class LineChangesViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private workspaceRoot: string;
	private sortBy: SortKey = 'name';
	private sortReversed = false;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	setSortBy(key: SortKey): void {
		if (this.sortBy === key) {
			this.sortReversed = !this.sortReversed;
		} else {
			this.sortBy = key;
			this.sortReversed = false;
		}
		this.updateSortContext();
		this.refresh();
	}

	updateSortContext(): void {
		vscode.commands.executeCommand('setContext', 'gitLineCountSummary.sortBy', this.sortBy);
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.onDidReceiveMessage((msg) => {
			if (msg.command === 'openFile') {
				const uri = vscode.Uri.file(path.join(this.workspaceRoot, msg.filePath));
				vscode.window.showTextDocument(uri);
			} else if (msg.command === 'showDiff') {
				const uri = vscode.Uri.file(path.join(this.workspaceRoot, msg.filePath));
				vscode.commands.executeCommand('git.openChange', uri);
			}
		});
		this.refresh();
	}

	refresh(): void {
		if (!this._view) { return; }
		const stats = this.getDiffStats();
		this._view.webview.html = this.getHtml(stats);
	}

	private getFileIconInfo(filePath: string): { codicon: string; color: string } {
		const ext = path.extname(filePath).toLowerCase();
		return FILE_ICON_MAP[ext] ?? DEFAULT_ICON;
	}

	private sortStats(stats: DiffStat[]): DiffStat[] {
		const sorted = [...stats];
		const dir = this.sortReversed ? -1 : 1;
		switch (this.sortBy) {
			case 'name':
				sorted.sort((a, b) => dir * path.basename(a.filePath).localeCompare(path.basename(b.filePath)));
				break;
			case 'added':
				sorted.sort((a, b) => dir * (b.added - a.added));
				break;
			case 'removed':
				sorted.sort((a, b) => dir * (b.removed - a.removed));
				break;
			case 'status':
				sorted.sort((a, b) => dir * a.status.localeCompare(b.status));
				break;
		}
		return sorted;
	}

	private getHtml(stats: DiffStat[]): string {
		const sorted = this.sortStats(stats);
		const rows = sorted.map((s) => {
			const fileName = path.basename(s.filePath);
			const dir = path.dirname(s.filePath);
			const dirDisplay = dir === '.' ? '' : dir.replace(/\//g, '\\') + '\\';
			const escapedPath = s.filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
			const iconInfo = this.getFileIconInfo(s.filePath);
			const statusColor = STATUS_COLORS[s.status] ?? '#8a8a8a';
			const clickAction = s.status === 'D' ? 'showDiff' : 'openFile';
			return `<div class="row" onclick="send('${clickAction}','${escapedPath}')" title="${s.filePath}">
				<span class="codicon ${iconInfo.codicon} file-icon" style="color:${iconInfo.color}"></span>
				<span class="name">${fileName}${dirDisplay ? `<span class="dir">${dirDisplay}</span>` : ''}</span>
				<span class="stats">
					<span class="added">+${s.added}</span>
					<span class="removed">-${s.removed}</span>
				</span>
				<span class="status" style="color:${statusColor}">${s.status}</span>
			</div>`;
		}).join('');

		let codiconsHref = '';
		try {
			if (this._view) {
				codiconsHref = this._view.webview.asWebviewUri(
					vscode.Uri.joinPath(vscode.Uri.file(path.dirname(require.resolve('@vscode/codicons/dist/codicon.css'))), 'codicon.css')
				).toString();
			}
		} catch { /* fallback */ }

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
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.file-icon {
		flex-shrink: 0;
		font-size: 16px;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dir {
		opacity: 0.7;
		font-size: 0.92em;
		margin-left: 6px;
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
		function send(command, filePath) {
			vscode.postMessage({ command, filePath });
		}
	</script>
</body>
</html>`;
	}

	private getDiffStats(): DiffStat[] {
		try {
			const fileMap = new Map<string, DiffStat>();
			const statusMap = this.getStatusMap();

			this.parseNumstat(this.runGit('diff --cached --numstat'), statusMap, fileMap);
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

	for (const key of ['name', 'added', 'removed', 'status'] as SortKey[]) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`gitLineCountSummary.sortBy.${key}`, () => provider.setSortBy(key))
		);
	}
	provider.updateSortContext();

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
