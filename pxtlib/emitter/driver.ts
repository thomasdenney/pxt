/// <reference path="../../built/typescriptServices.d.ts"/>

// Enforce order:
/// <reference path="util.ts"/>
/// <reference path="cloud.ts"/>
/// <reference path="thumb.ts"/>
/// <reference path="ir.ts"/>
/// <reference path="emitter.ts"/>
/// <reference path="backthumb.ts"/>
/// <reference path="decompiler.ts"/>

namespace ts.pxt {
    export interface CompileTarget {
        simulatorPostMessage?: boolean; // provided by simulator as a post command message
        isNative: boolean; // false -> JavaScript for simulator
        nativeType?: string; // currently only "thumb"
        hasHex: boolean;
        hexMimeType?: string;
        driveName?: string;
        jsRefCounting?: boolean;
        floatingPoint?: boolean;
        deployDrives?: string; // partial name of drives where the .hex file should be copied
    }

    export interface CompileOptions {
        fileSystem: StringMap<string>;
        target: CompileTarget;
        testMode?: boolean;
        sourceFiles?: string[];
        hexinfo: any;
        extinfo?: ExtensionInfo;
        noEmit?: boolean;
        ast?: boolean;
        breakpoints?: boolean;
        justMyCode?: boolean;

        embedMeta?: string;
        embedBlob?: string; // base64
    }

    export interface Breakpoint extends LocationInfo {
        id: number;
        isDebuggerStmt: boolean;
        // TODO: this would be useful for step-over support
        // prevBrkId?:number;
    }

    export interface CompileResult {
        outfiles: StringMap<string>;
        diagnostics: KsDiagnostic[];
        success: boolean;
        times: U.Map<number>;
        ast?: Program;
        breakpoints?: Breakpoint[];
        blocksInfo?: BlocksInfo;
    }

    export function getTsCompilerOptions(opts: CompileOptions) {
        let options = ts.getDefaultCompilerOptions()

        options.target = ScriptTarget.ES5;
        options.module = ModuleKind.None;
        options.noImplicitAny = true;
        options.noImplicitReturns = true;
        options.allowUnreachableCode = true;
        return options
    }

    export interface LocationInfo {
        fileName: string;
        start: number;
        length: number;

        //derived
        line: number;
        character: number;
    }

    export interface KsDiagnostic extends LocationInfo {
        code: number;
        category: DiagnosticCategory;
        messageText: string | DiagnosticMessageChain;
    }

    export function nodeLocationInfo(node: ts.Node) {
        let file = getSourceFileOfNode(node)
        const { line, character } = ts.getLineAndCharacterOfPosition(file, node.pos);
        let r: LocationInfo = {
            start: node.pos,
            length: node.end - node.pos,
            line: line,
            character: character,
            fileName: file.fileName,
        }
        return r
    }

    export interface FunctionLocationInfo extends LocationInfo {
        functionName: string;
    }

    export function patchUpDiagnostics(diags: Diagnostic[]) {
        let highPri = diags.filter(d => d.code == 1148)
        if (highPri.length > 0)
            diags = highPri;
        return diags.map(d => {
            if (!d.file) {
                let rr: KsDiagnostic = {
                    code: d.code,
                    start: d.start,
                    length: d.length,
                    line: 0,
                    character: 0,
                    messageText: d.messageText,
                    category: d.category,
                    fileName: "?",
                }
                return rr
            }

            const pos = ts.getLineAndCharacterOfPosition(d.file, d.start);
            let r: KsDiagnostic = {
                code: d.code,
                start: d.start,
                length: d.length,
                line: pos.line,
                character: pos.character,
                messageText: d.messageText,
                category: d.category,
                fileName: d.file.fileName,
            }
            if (r.code == 1148)
                r.messageText = Util.lf("all symbols in top-level scope are always exported; please use a namespace if you want to export only some")
            return r
        })
    }

    /*
     * Main driving function for the compiler
    */
    export function compile(opts: CompileOptions) {
        let startTime = Date.now()
        let res: CompileResult = {
            outfiles: {},
            diagnostics: [],
            success: false,
            times: {},
        }

        let fileText = opts.fileSystem
        let setParentNodes = true
        let options = getTsCompilerOptions(opts)

        let host: CompilerHost = {
            getSourceFile: (fn, v, err) => {
                let text = ""
                if (fileText.hasOwnProperty(fn)) {
                    text = fileText[fn]
                } else {
                    if (err) err("File not found: " + fn)
                }
                return createSourceFile(fn, text, v, setParentNodes)
            },
            fileExists: fn => fileText.hasOwnProperty(fn),
            getCanonicalFileName: fn => fn,
            getDefaultLibFileName: () => "no-default-lib.d.ts",
            writeFile: (fileName, data, writeByteOrderMark, onError) => {
                res.outfiles[fileName] = data
            },
            getCurrentDirectory: () => ".",
            useCaseSensitiveFileNames: () => true,
            getNewLine: () => "\n",
            readFile: fn => fileText[fn] || "",
            directoryExists: dn => true,
        }

        if (!opts.sourceFiles)
            opts.sourceFiles = Object.keys(opts.fileSystem)

        let tsFiles = opts.sourceFiles.filter(f => U.endsWith(f, ".ts"))
        //createProgram is part of the TypeScript compiler; it parses the TypeScript source to an AST
        let program = createProgram(tsFiles, options, host);

        // First get and report any syntactic errors.
        res.diagnostics = patchUpDiagnostics(program.getSyntacticDiagnostics());
        if (res.diagnostics.length > 0) return res;

        // If we didn't have any syntactic errors, then also try getting the global and
        // semantic errors.
        res.diagnostics = patchUpDiagnostics(program.getOptionsDiagnostics().concat(program.getGlobalDiagnostics()));

        if (res.diagnostics.length == 0) {
            res.diagnostics = patchUpDiagnostics(program.getSemanticDiagnostics());
        }

        let emitStart = Date.now()
        res.times["typescript"] = emitStart - startTime

        if (opts.ast) {
            res.ast = program
        }

        if (opts.ast || res.diagnostics.length == 0) {
            //Call that produces hex file
            const binOutput = compileBinary(program, host, opts, res);
            res.times["compilebinary"] = Date.now() - emitStart
            res.diagnostics = patchUpDiagnostics(binOutput.diagnostics)
        }

        if (res.diagnostics.length == 0)
            res.success = true

        for (let f of opts.sourceFiles) {
            if (Util.startsWith(f, "built/"))
                res.outfiles[f.slice(6)] = opts.fileSystem[f]
        }

        return res
    }

    export function decompile(opts: CompileOptions, fileName: string) {
        let resp = compile(opts);
        if (!resp.success) return resp;

        let file = resp.ast.getSourceFile(fileName);
        let apis = getApiInfo(resp.ast);
        let blocksInfo = ts.pxt.getBlocksInfo(apis);
        let bresp = ts.pxt.decompiler.decompileToBlocks(blocksInfo, file)
        return bresp;
    }
}