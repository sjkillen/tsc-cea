"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../src/must_execute");
function helper(baz) {
    baz();
}
function main(foo) {
    helper(foo);
    if (foo.mustHaveExecuted()) {
        console.log("YES!");
    }
    else {
        console.log("NO!");
    }
}
main(() => 0);
//# sourceMappingURL=test.js.map