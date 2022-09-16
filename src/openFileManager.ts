import * as vscode from "vscode";
import * as fs from 'fs';
import * as path from 'path';
import { Uri } from "vscode";
import * as request from "request-promise-native";

export class OpenFileManager {

    private _config: { [key: string]: string } = {};

    private pathSep = /\\|\//;

    private get activeDirName(): string {
        var name = vscode.window.activeTerminal?.name;
        if (name && this._config[name] && fs.existsSync(this._config[name])) {
            return name;
        } else {
            if (fs.existsSync(this._config['defaultPath'])) {
                return "defaultPath";
            }
        }
        vscode.window.showInformationMessage("You doesn't have a defaultPath!");
        return '';
    }

    private get activeDir(): string {
        const dirName = this.activeDirName;
        if (dirName && fs.existsSync(this._config[dirName])) {
            return this._config[dirName];
        }
        vscode.window.showInformationMessage("You config setting defaultPath is not correct!");
        return '';
    }

    public constructor() {
        this.loadConfig();
    }

    public async cdDirectory() {
        let physicDir = await this.getSelectedToPhysicPath();
        if (physicDir) {
            let dir = physicDir;
            fs.stat(physicDir, (e, s) => {
                if (!s.isDirectory()) {
                    dir = path.dirname(dir);
                }
                vscode.window.activeTerminal?.sendText("cd " + dir);
            });
        }
    }

    public loadConfig(): void {
        this._config = <any>vscode.workspace.getConfiguration("quickcd");
        this._config.paths?.trim()?.split(";").forEach((value, index) => {
            if (value) {
                var key = value.trim().split(this.pathSep).join('_').replace(':', '');

                this._config = Object.assign({ [key]: value }, this._config);
            }
        });
    }

    public async openInVsCode() {
        let selection: string = await this.getSelectedToPhysicPath();
        if (selection) {
            fs.stat(selection, async (error, stats) => {
                if (!stats.isDirectory()) {
                    let uri = Uri.file(selection);
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            });
        }
    }

    public async openInVisualStudio() {
        let physicDir = await this.getSelectedToPhysicPath();
        if (physicDir) {
            let p = this.getProjectFileFromPath(physicDir);
            if (p == '') {
                return;
            }
            vscode.window.activeTerminal?.sendText("cd " + path.dirname(p));
            vscode.window.activeTerminal?.sendText(p.split(this.pathSep).pop() as string);
        }
    }

    public async GetProjectFilePath() {
        let physicDir = await this.getSelectedToPhysicPath();
        const pPath = this.getProjectFileFromPath(physicDir, 3);
        pPath.replace(this.activeDir, '');
    }

    private getProjectFileFromPath(physicDir: string, recursive: number = 3): string {
        if (physicDir.endsWith("proj")) {
            return physicDir;
        }

        const folder = fs.lstatSync(physicDir).isDirectory() ? physicDir : path.dirname(physicDir);
        const files = fs.readdirSync(folder);
        for (let index = 0; index < files.length; index++) {
            const element = files[index];
            if (element.endsWith("proj")) {
                return path.join(folder, element);
            }
        }

        if (recursive > 0) {
            const dir = path.dirname(folder);
            const p = this.getProjectFileFromPath(path.dirname(folder), recursive--);
            if (p != '') {
                return p;
            }
        }

        return '';
    }

    public async revealInFileExplorer() {
        let selection: string = await this.getSelectedToPhysicPath();
        if (selection) {
            fs.stat(selection, (e, s) => {
                let dir = s.isDirectory() ? selection : path.dirname(selection);
                require('child_process').exec("start " + dir);
            })
        }
    }

    public createTerminal(name: string = '') {
        let canCreate = [];
        for (let key in this._config) {
            const keyStr = key.toString();
            if (keyStr != "cmdPath" && fs.existsSync(this._config[keyStr])) {
                canCreate.push(keyStr);
            }
        }
        if (canCreate.length == 0) {
            vscode.window.showInformationMessage("You has not set config paths value!");
            return;
        }
        if (name == "defaultPath") {
            this.creatNamedTerminal(canCreate[0]);
        } else {
            vscode.window.showQuickPick(canCreate).then(res => {
                if (res) {
                    this.creatNamedTerminal(res);
                }
            });
        }
    }

    private creatNamedTerminal(name: string) {
        const existT = vscode.window.activeTerminal?.name;
        if (existT && !this._config[existT]) {
            vscode.window.activeTerminal?.dispose();
        }

        const dir = this._config[name];
        if (!fs.existsSync(dir)) {
            vscode.window.showInformationMessage("Can't create terminal. path:" + dir + " is not exist.");
            return;
        }

        var terminal = vscode.window.createTerminal(name);
        var cmd = "SET INETROOT=" + dir + "&cd /d " + dir + "&gvfs mount&" + dir + "\\tools\\path1st\\myenv.cmd";
        terminal.show();
        terminal.sendText(cmd);
    }

    public changeTerminal(t: vscode.Terminal | undefined) {

    }

    public onCloseTerminal(t: vscode.Terminal | undefined) {
    }

    private async getSelectedToPhysicPath(): Promise<string> {
        let selection = this.getSlection();

        if (fs.existsSync(selection)) {
            return selection;
        }

        const combinedPath = this.combinePath(selection);
        if (fs.existsSync(combinedPath)) {
            return combinedPath;
        }

        if (selection.endsWith('.dll')) {
            const arr = selection.split(this.pathSep);
            const relativePath = await this.getfileLocationFromRemoteDGT(arr[arr.length - 1]);
            return this.combinePath(relativePath);
        }

        return '';
    }

    private combinePath(relativePath: string): string {
        const existT = vscode.window.activeTerminal?.name;

        if (existT && this._config[existT]) {
            const rootpath = this._config[existT].toString();
            const combinedPath = path.join(rootpath, relativePath);
            if (fs.existsSync(combinedPath)) {
                return combinedPath;
            }
        }

        for (let key in this._config) {
            const rootpath = this._config[key].toString();
            if (rootpath && fs.existsSync(rootpath)) {
                const combinedPath = path.join(rootpath, relativePath);
                if (fs.existsSync(combinedPath)) {
                    return combinedPath;
                }
            }
        }
        return '';
    }

    private getSlection() {
        let selection;
        const activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor) {
            selection = this.indentifyTxt(activeTextEditor.selection);
        }

        return selection ? selection.trim() : '';
    }

    private indentifyTxt(range: vscode.Range): string | undefined {
        var text = vscode.window.activeTextEditor?.document.getText(range);
        if (!range.isEmpty) {
            return text;
        }

        var findRange = range;
        let start = range.start.character;
        let end = range.end.character;

        const regx = /\w|\.|\_|\\|\/|\:/;

        do {
            findRange = new vscode.Range(new vscode.Position(range.start.line, start--), new vscode.Position(range.end.line, start));
            text = vscode.window.activeTextEditor?.document.getText(findRange);
        } while (start > 0 && text?.match(regx) != null)

        const maxCharater = vscode.window.activeTextEditor?.document.lineAt(range.start.line).range.end.character;
        do {
            findRange = new vscode.Range(new vscode.Position(range.start.line, end), new vscode.Position(range.end.line, ++end));
            text = vscode.window.activeTextEditor?.document.getText(findRange);
        } while (end < <number>maxCharater && text?.match(regx) != null)

        let r = new vscode.Range(new vscode.Position(range.start.line, start), new vscode.Position(range.end.line, end));
        text = vscode.window.activeTextEditor?.document.getText(r);

        if (text?.substr(0, 1).match(regx) == null) {
            text = text?.substr(1);
        }
        console.log(text?.charAt(text.length).match(regx) == null)
        console.log(text?.substr(-1))
        if (text?.substr(-1) != '' && text?.substr(-1).match(regx) == null) {
            text = text?.substr(0, text.length - 1);
            console.log(text)
        }
        return text;
    }

    private async getfileLocationFromRemoteDGT(name: string) {
        let version = await this.getLatestVersion();
        if (!version) {
            return '';
        }

        let address = this._config["DGTAddress"] || "http://10.158.22.18";

        const url = address + "/api/graph/assembly/details?";

        let result = await request.get({
            uri: url + this.objectToQueryString({
                assembly: name,
                version: version,
                process: ''
            })
        });

        result = JSON.parse(result);
        if (result && result["status"] == 200) {
            if (!(result["data"] && result["data"]["sourcePath"])) {
                vscode.window.showInformationMessage(name + " can't fond in DGT.")
                return '';
            }

            let res = result["data"]["sourcePath"] as string;
            res = res.replace(version, 'version');
            res = res.replace(/\\/g, '/');

            res = res.replace("//redmond/exchange/build/substrate/version/Sources/", '');
            return res;
        }

        return '';
    }

    private async getLatestVersion() {
        let address = this._config["DGTAddress"] || "http://10.158.22.18";
        if (!address) {
            return '';
        }

        const url = address + "/api/graph/latest-version";
        var options = {
            uri: url,
        };
        let result;
        try {
            result = await request.get(options);
        } catch (error) {
            vscode.window.showInformationMessage("Request to " + url + " failed.")
        }

        result = JSON.parse(result);
        if (result && result["status"] == 200 && result["data"]) {
            return result["data"];
        }

        return '';
    }

    private objectToQueryString(obj: any) {
        var str = [];
        for (var p in obj) {
            if (obj.hasOwnProperty(p)) {
                str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
            }
        }

        return str.join("&");
    }
}