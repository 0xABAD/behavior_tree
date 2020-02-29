//@ts-check

// Node states
const FAILED = 0,
      SUCCESS = 1,
      RUNNING = 2;

// Node kinds
const FALLBACK = 'fallback',
      SEQUENCE = 'sequence',
      PARALLEL = 'parallel',
      ACTION = 'action',
      CONDITION = 'condition';

function expect(what, have) {
    return `Expecting '${what}', have '${have}'`;
}

/**
 * Parses sequence node
 * @param {string} buf behavior tree model
 * @param {number} i current index
 * @returns {[number, string | null]} tuple with adjusted current parsing index and error message or null
 */
function parseSequence(buf, i) {
    if (i < buf.length) {
        let ch = buf[i];
        if (ch == '>') {
            i++;
            return [i, null];
        } else {
            return [i, expect('>', ch)];
        }
    } else {
        return [i, expect('>', 'EOF')];
    }
}

function parseCondition(buf, i) {
    let cond = '';
    while (i < buf.length) {
        let ch = buf[i];
        i++;
        if (ch == ')') {
            return [i, cond.trim(), undefined];
        } else {
            cond = cond.concat(ch);
        }
    }
    return [i, cond, expect(')', 'EOF')];
}

function parseAction(buf, i) {
    let action = '';
    while (i < buf.length) {
        let ch = buf[i];
        i++;
        if (ch == ']') {
            return [i, action.trim(), undefined];
        } else {
            action = action.concat(ch);
        }
    }
    return [i, action, expect(']', 'EOF')];
}

function parseParallel(buf, i) {
    let numBuf = '';
    while (i < buf.length) {
        let ch = buf[i];
        let m = ch.match(/\d/);
        if (m && m.length == 1) {
            numBuf += ch;
        } else {
            break;
        }
        i++;
    }
    if (numBuf === '') {
        return [0, i, 'Expecting number after parallel node.'];
    }
    let num = parseInt(numBuf);
    if (num === 0) {
        return [0, i, 'Parallel node must allow at least one child.'];
    }
    return [num, i, null];
}

function node(name, kind, kids) {
    let n = {};
    n.name = name;
    n.kind = kind;
    n.children = kids || null;
    n.active = false;
    n.wasActive = false;
    n.nodeStatus = FAILED;
    n.status = function() {
        if (n.hasNot) {
            switch (n.nodeStatus) {
            case SUCCESS: return FAILED;
            case FAILED:  return SUCCESS;
            }
        }
        return n.nodeStatus;
    };
    n.setStatus = function(s) {
        n.nodeStatus = s;
    };
    n.tick = function() {
        n.active = true;
        return n.status();
    };
    n.deactivate = function() {
        n.active = false;
        if (n.children) {
            for (let i = 0; i < n.children.length; i++) {
                n.children[i].deactivate();
            }
        }
    };
    return n;
}

function fallback() {
    let fb = node('?', FALLBACK, []);
    fb.tick = function() {
        fb.active = true;
        for (let i = 0; i < fb.children.length; i++) {
            let s = fb.children[i].tick();
            fb.setStatus(s);
            if (s == RUNNING || s == SUCCESS) {
                return fb.status();
            }
        }
        fb.setStatus(FAILED);
        return fb.status();
    };
    return fb;
}

function sequence() {
    let seq = node('\u2192', SEQUENCE, []);
    seq.tick = function() {
        seq.active = true;
        for (let i = 0; i < seq.children.length; i++) {
            let s = seq.children[i].tick();
            seq.setStatus(s);
            if (s == RUNNING || s == FAILED) {
                return seq.status();
            }
        }
        seq.setStatus(SUCCESS);
        return seq.status();
    };
    return seq;
}

function parallel(successCount) {
    let par = node('\u21C9', PARALLEL, []);
    par.successCount = successCount;
    par.tick = function() {
        par.active = true;

        let succeeded = 0,
            failed    = 0,
            kidCount  = par.children.length;

        for (let i = 0; i < par.children.length; i++) {
            let s = par.children[i].tick();
            if (s == SUCCESS) {
                succeeded++;
            }
            if (s == FAILED) {
                failed++;
            }
        }

        let st = RUNNING;
        if (succeeded >= successCount) {
            st = SUCCESS;
        } else if (failed > kidCount - successCount) {
            st = FAILED;
        }
        par.setStatus(st);
        return st;
    };
    return par;
}

function action(name) {
    let a = node(name, ACTION);
    a.setStatus(RUNNING);
    return a;
}

function condition(name, hasNot) {
    let c = node(name, CONDITION);
    c.hasNot = hasNot; // ensure the property is declared in both cases
    return c;
}

class BehaviorTree {
    /**
     * Behavior Tree
     * @param {any} root tree root node
     * @param {Map<string, any[]>} actions list of actions grouped by name
     * @param {Map<string, any[]>} conditions list of conditions grouped by name
     * @param {number} line line at which the error ocurred
     * @param {string} error parsing error
     */
    constructor(root, actions, conditions, line, error = null) {
        this.root = root;
        this.actions = actions;
        this.conditions = conditions;
        this.line = line;
        this.error = error;
    }

    /**
     * Re-builds the behavior tree from JSON e.g. after it has been loaded from a file, or transferred via http.
     * @param {any} treeAsJson behavior tree in a JSON form
     * @returns {BehaviorTree}
     */
    static fromJson(treeAsJson) {
        let actions = new Map();
        let conditions = new Map();
        let rootNode = BehaviorTree.nodeFromJson(treeAsJson.root, actions, conditions);
        return new BehaviorTree(rootNode, actions, conditions, treeAsJson.line, treeAsJson.error);
    }

    /**
     * Re-builds tree node.
     * @param {any} nodeAsJson node in plain JSON form
     * @param {Map<string, any[]>} actions map to register all actions found
     * @param {Map<string, any[]>} conditions map to register all conditions found
     */
    static nodeFromJson(nodeAsJson, actions, conditions) {
        let node;
        switch (nodeAsJson.kind) {
            case FALLBACK:
                node = fallback();
                break;
            case SEQUENCE:
                node = sequence();
                break;
            case PARALLEL:
                node = parallel(nodeAsJson.successCount);
                break;
            case ACTION:
                node = action(nodeAsJson.name);
                addToArrayMap(actions, node.name, node);
                break;
            case CONDITION:
                node = condition(nodeAsJson.name, nodeAsJson.hasNot);
                addToArrayMap(conditions, node.name, node);
                break;
            default:
                throw new Error(`Unexpected node kind: ${nodeAsJson.kind}.`);
        }

        if (nodeAsJson.children) {
            node.children = nodeAsJson.children.map(child => this.nodeFromJson(child, actions, conditions));
        }

        return node;
    }
}

/**
 * Parser
 * @param {string} buf behavior tree as text
 * @returns {BehaviorTree}
 */
function parse(buf) {
    let indent     = 0,        // current recorded indentation
        line       = 1,        // line number in text
        nodes      = [null],   // node tree
        actions    = new Map(),// action nodes grouped by name
        conditions = new Map(),// condition nodes grouped by name
        notPending = false,    // is 'not' decorator waiting to be applied?
        i          = 0;

    function pushNode(node) {
        if (indent === 0 && nodes[indent]) {
            return `More than one root node or node '${node.name}' has wrong indentation.`;
        }
        if (indent > 0) {
            let parent = nodes[indent - 1];
            if (!parent) {
                return `${node.name} node has no parent (wrong indentation level)`;
            }
            if (parent.children) {
                parent.children.push(node);
                nodes[indent] = node;
            } else {
                return `${parent.kind} node can't have child nodes`;
            }
        } else {
            nodes[indent] = node;
        }
        indent++; // nested child on the same line should be indented
        return null;
    };

    function onError(err) {
        return new BehaviorTree(null, actions, conditions, line, err);
    }

    while (i < buf.length) {
        let ch     = buf[i],
            notNow = false;
        i++;

        switch (ch) {
        case ' ':
        case '\t':
            break;

        case '\r': {
            if (i < buf.length && buf[i] === '\n') {
                i += 1;
            }
            line++;
            indent = 0;
        } break;

        case '\n': {
            line++;
            indent = 0;
        } break;

        case '|': {
            indent++;
        } break;

        case '!': {
            if (notPending) {
                // Not operator cancels itself out.
                notPending = false;
            } else {
                notNow = true;
                notPending = true;
            }
        } break;

        case '=': {
            let [num, n, err] = parseParallel(buf, i);
            if (err) {
                return onError(err);
            }
            i = n;
            let p = parallel(num);
            let e = pushNode(p);
            if (e) {
                return onError(e);
            }
        } break;

        case '?': {
            let err = pushNode(fallback());
            if (err) {
                return onError(err);
            }
        } break;

        case '-': {
            let [n, err] = parseSequence(buf, i);
            if (err) {
                return onError(err);
            }
            i = n;
            let e = pushNode(sequence());
            if (e) {
                return onError(e);
            }
        } break;

        case '(': {
            let [n, name, err] = parseCondition(buf, i);
            if (err) {
                return onError(err);
            }
            i = n;
            let c = condition(name, notPending);
            addToArrayMap(conditions, name, c);
            if (notPending) {
                notPending = false;
            }
            let e = pushNode(c);
            if (e) {
                return onError(e);
            }
        } break;

        case '[': {
            let [n, name, err] = parseAction(buf, i);
            if (err) {
                return onError(err);
            }
            i = n;
            let a = action(name);
            addToArrayMap(actions, name, a);
            let e = pushNode(a);
            if (e) {
                return onError(e);
            }
        } break;

        default:
            let err = `Expecting '|', '-', '!', '[', or '(' but have '${ch}'`;
            return onError(err);
        }

        if (!notNow && notPending) {
            let err = 'Not operator can only be applied to conditions';
            return onError(err);
        }
        notNow = false;
    }
    if (!nodes[0]) {
        let e = 'Tree must have at least one node but has none';
        return onError(e);
    }

    return new BehaviorTree(nodes[0], actions, conditions, line, null);
}

function addToArrayMap(map, key, value) {
    if (map[key]) {
        map[key].push(value);
    } else {
        map[key] = [value];
    }
}

const SAMPLE_TREE = `
?
|    ->
|    |    (Ghost Close)
|    |    ?
|    |    |    ->
|    |    |    |    !(Ghost Scared)
|    |    |    |    (Power Pill Close)
|    |    |    |    [Eat Power Pill]
|    |    |    ->
|    |    |    |    (Ghost Scared)
|    |    |    |    [Chase Ghost]
|    |    |    [Avoid Ghost]
|    =1
|    |    [Eat Pills]
|    |    [Eat Fruit]
`;

if (typeof exports !== 'undefined' && exports) {
    exports.bt = {
        BehaviorTree,
        parse, SUCCESS, FAILED, RUNNING,
        fallback, sequence, parallel, condition, action,
        FALLBACK, SEQUENCE, PARALLEL, CONDITION, ACTION,
        SAMPLE_TREE
    };
}