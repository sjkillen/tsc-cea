import { resolve } from "path";

import * as ts from "typescript";
import stackTrace from "stack-trace";

import { execute as symExec } from "./sonarts/sonarts-core/src/se/SymbolicExecution";
import { build as buildCFG } from "./sonarts/sonarts-core/src/cfg/builder";
import { ProgramState, createInitialState } from "./sonarts/sonarts-core/src/se/programStates";
import { SymbolicValueType } from "./sonarts/sonarts-core/src/se/symbolicValues";
import { isTruthy, Constraint, isFalsy, ConstraintKind, isExecuted } from "./sonarts/sonarts-core/src/se/constraints";
import { SymbolTableBuilder } from "./sonarts/sonarts-core/src/symbols/builder";
import { SymbolTable, UsageFlag } from "./sonarts/sonarts-core/src/symbols/table";
import { firstLocalAncestor, FUNCTION_LIKE } from "./sonarts/sonarts-core/src/utils/navigation";
import { TypedSonarRuleVisitor } from "./sonarts/sonarts-core/src/utils/sonarAnalysis";
import { isArrowFunction, isBlock, isIdentifier, isPropertyAccessExpression } from "./sonarts/sonarts-core/src/utils/nodes";
import { TreeVisitor } from "./sonarts/sonarts-core/src/utils/visitor";


const { compilerOptions } = require("../tsconfig.json");

// From SonarTS
function getStatements(functionLike: ts.FunctionLikeDeclaration): ts.Statement[] {
    if (isArrowFunction(functionLike)) {
        // `body` can be a block or an expression
        if (isBlock(functionLike.body)) {
            return Array.from(functionLike.body.statements);
        }
    } else {
        return (functionLike.body && Array.from(functionLike.body.statements))!;
    }
    return (undefined)!;
}

class FunctionFinder extends TreeVisitor {
    private result: ts.FunctionLikeDeclaration | null = null;
    private name: string | null = null;
    private obj: string | null = null;
    constructor(private src: ts.SourceFile) {
        super();
    }
    protected visitFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration) {
        if ((this.name && node.name) && (this.name === node.name.getText())) {
            this.result = node;
        } else {
            super.visitFunctionLikeDeclaration(node);
        }
    }
    public findName(name: string): ts.FunctionLikeDeclaration | null {
        this.result = null;
        this.obj = null;
        this.name = name;
        this.visit(this.src);
        return this.result;
    }
}

class FunctionCallFinder extends TreeVisitor {
    private result: ts.CallExpression | null = null;
    private line: number = -1;
    constructor(private src: ts.SourceFile) {
        super();
    }
    protected visitCallExpression(node: ts.CallExpression) {
        nope: if (isPropertyAccessExpression(node.expression)) {
            const methodName = node.expression.name.getText();
            if (methodName !== "mustHaveExecuted") {
                break nope;
            }
            const line = this.src.getLineAndCharacterOfPosition(node.expression.getStart()).line + 1;
            if (this.line - line < 2) {
                this.result = node;
                return;
            }
        }
        super.visitCallExpression(node);
    }
    public find(line: number): ts.FunctionLikeDeclaration | null {
        this.line = line;
        this.result = null;
        this.visit(this.src);
        return this.result;
    }
}

declare global {
    interface Function {
        mustHaveExecuted(): boolean;
    }
}


const results: any = {}
const programs: any = {};

function symbolicAnalysis(fileName: string, funcName: string) {
    const [prog, src, symbols] = programs[fileName];
    const finder = new FunctionFinder(src);
    const containerFuncNode = finder.findName(funcName)!;
    const stmts = getStatements(containerFuncNode);
    const cfg = buildCFG(stmts)!;
    const ps = createInitialState(containerFuncNode, prog);

    const result = symExec(cfg, symbols, ps);
    return result;
}


function alwaysExecuted(pss: ProgramState[], func: ts.Symbol) {
    return pss.every(ps => isExecuted(ps.getConstraints(ps.sv(func)!)));
}

Function.prototype.mustHaveExecuted = function (): boolean {
    const err = new Error();
    const trace = stackTrace.parse(err)[1];
    const fileName = trace.getFileName().replace(/\.js$/, ".ts");
    const funcName = trace.getFunctionName();
    const lineNumber = trace.getLineNumber();
    const prog = ts.createProgram([fileName], compilerOptions);
    const src = prog.getSourceFile(fileName)!;
    const symbols = SymbolTableBuilder.build(src, prog);
    programs[fileName] = [prog, src, symbols];
    const key = fileName + funcName;
    let result;
    if (key in results) {
        result = results[key];
    } else {
        result = results[key] = symbolicAnalysis(fileName, funcName);
    }

    const callFinder = new FunctionCallFinder(src);
    const callSite = callFinder.find(lineNumber);

    const targetFinder = new FunctionFinder(src);
    const targetFunc = targetFinder.findName(this.name)!;

    const ps = result.programNodes.get(callSite);


    return alwaysExecuted(result.programNodes.get(callSite), (targetFunc as any).symbol);

}