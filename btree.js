const FAILED  = 0,
      SUCCESS = 1,
      RUNNING = 2;

const SAMPLE_TREE = `
?
|    ->
|    |     (Ghost Close)
|    |     ?
|    |     |    ->
|    |     |    |    (Ghost Scared)
|    |     |    |    [Chase Ghost]
|    |     |    [Avoid Ghost]
|    [Eat Pills]
`;

function expect(what, have) {
    return `Expecting '${what}', have '${have}'`;
}

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

function node(name, kind, kids) {
    let n = {};
    n.name = name;
    n.kind = kind;
    n.children = kids || null;
    n.status = FAILED;
    n.active = false;
    n.wasActive = false;
    n.tick = function() {
        n.active = true;
        return n.status;
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
    let fb = node('?', 'fallback', []);    
    fb.tick = function() {
        fb.active = true;
        for (let i = 0; i < fb.children.length; i++) {
            fb.status = fb.children[i].tick();
            if (fb.status == RUNNING || fb.status == SUCCESS) {
                return fb.status;
            }
        }
        fb.status = FAILED;
        return fb.status;
    };
    return fb;
}

function sequence() {
    let seq = node('\u2192', 'sequence', []);
    seq.tick = function() {
        seq.active = true;
        for (let i = 0; i < seq.children.length; i++) {
            seq.status = seq.children[i].tick();
            if (seq.status == RUNNING || seq.status == FAILED) {
                return seq.status;
            }
        }
        seq.status = SUCCESS;
        return seq.status;
    };
    return seq;
}

function action(name) {
    let a = node(name, 'action');
    a.status = RUNNING;
    return a;
}

function condition(name) { return node(name, 'condition'); }

function parse(buf) {
    let indent     = 0,      // current recorded indentation
        line       = 1,      // line number in text
        nodes      = [null], // node tree
        actions    = {},     // unique action nodes
        conditions = {},     // unique condition nodes
        i          = 0;

    function pushNode(node) {
        if (indent === 0 && nodes[indent]) {
            return 'More than one root node';
        }
        let parent = nodes[indent - 1];
        if (parent) {
            if (parent.children) {
                parent.children.push(node);
                nodes[indent] = node;
            } else {
                return `${parent.kind} can't have child nodes`;
            }
        } else {
            nodes[indent] = node;
        }
        indent = 0;
        return null;
    };

    function onError(err) {
        return {root: null, actions, conditions, line, error: err};
    }

    while (i < buf.length) {
        let ch = buf[i];
        i++;

        switch (ch) {
        case ' ':
        case '\t':
            break;

        case '\n': {
            line++;
        } break;

        case '|': {
            indent++;
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
                return {root: null, actions, conditions, line, err};
            }
            i = n;
            let e = pushNode(sequence());
            if (err) {
                return onError(e);
            }
        } break;

        case '(': {
            let [n, name, err] = parseCondition(buf, i);
            if (err) {
                return onError(err);
            }
            i = n;
            let c = condition(name);
            if (conditions[name]) {
                conditions[name].push(c);
            } else {
                conditions[name] = [c];
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
            if (actions[name]) {
                actions[name].push(a);
            } else {
                actions[name] = [a];
            }
            let e = pushNode(a);
            if (e) {
                return onError(e);
            }
        } break;

        default:
            let err = `Expecting '|', '-', '[', or '(' but have '${ch}'`;
            return onError(err);
        }
    }
    if (!nodes[0]) {
        let e = 'Tree must have at least one node but has none';
        return onError(e);
    }

    return { root: nodes[0], line, actions, conditions, error: null };
}

// Render _root_ inside the _parent_ DOM node with a viewbox width
// of _width_.  _x0_ and _x1_ are used to determine the vertical height
// of the tree inside the viewbox.
function renderTree(parent, root, width, x0, x1) {
    const svg = d3.select(parent)
          .html('')
          .append('svg')
          .attr('width', '100%')
          .attr('height', '100%')
          .attr('viewBox', [0, 0, width, x1 - x0 + root.dx * 4]);
    
    const g = svg.append('g')
          .attr('font-family', 'sans-serif')
          .attr('font-size', 12)
          .attr('transform', `translate(${root.dy}, ${root.dx - x0})`);
    
    const link = g.append('g')
          .attr('fill', 'none')
          .attr('stroke', '#555')
          .attr('stroke-opacity', 0.4)
          .attr('stroke-width', 1.5)
          .selectAll('path')
          .data(root.links())
          .join('path')
          .attr('d', d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));
    
    const node = g.append('g')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-width', 3)
          .selectAll('g')
          .data(root.descendants())
          .join('g')
          .attr('transform', d => `translate(${d.y},${d.x})`);

    function nodeColor(active, status) {
        let base       = 'BF',
            amp        = '11',
            color      = '#${base}${amp}${amp}',
            fill       = 'white',
            text_color = 'black';

        if (active) {
            amp = '50';
        }
        switch (status) {
        case FAILED:  color = `#${base}${amp}${amp}`; break;
        case SUCCESS: color = `#${amp}${base}${amp}`; break;
        case RUNNING: color = `#${amp}${amp}${base}`; break;
        }
        return color;
    }

    node.each(function(d) {
        let active = d.data.active,
            k      = d.data.kind;

        if (k == 'sequence' || k == 'fallback') {
            let color      = nodeColor(active, d.data.status),
                fill       = 'white',
                text_color = 'black';

            if (active) {
                fill = color;
                color = '#444';
                text_color = 'white';
            }

            const SZ = 24;

            d3.select(this)
                .append('rect')
                .attr('x', -SZ / 2)
                .attr('y', -SZ / 2)
                .attr('width', SZ)
                .attr('height', SZ)
                .attr('fill', fill)
                .attr('stroke-width', 2)
                .attr('stroke', color);
            d3.select(this)
                .append('text')
                .attr('dy', '0.31em')
                .attr('x', d => d.data.kind == 'sequence' ? 5 : 3)
                .attr('text-anchor', 'end')
                .text(d.data.name)
                .attr('fill', text_color)
                .clone(true).lower();
        }

        if (k == 'condition' || k == 'action') {
            let container,
                color      = nodeColor(active, d.data.status),
                fill       = 'white',
                text_color = 'black';

            if (active) {
                fill = color;
                color = '#111';
                text_color = 'white';
            }

            if (k == 'condition') {
                container = d3.select(this).append('ellipse');
            }
            if (k == 'action') {
                container = d3.select(this).append('rect');
            }
            container
                .attr('fill', fill)
                .attr('stroke-width', 2)
                .attr('stroke', color);
            
            const PAD = 10;

            let text = d3.select(this)
                .append('text')
                .attr('dy', '0.31em')
                .attr('text-anchor', 'middle')
                .attr('fill', text_color)
                .text(d.data.name)
                .clone(true).lower()
                .node();

            let width = text.getComputedTextLength() + PAD;
            if (k == 'condition') {
                container
                    .attr('rx', width/1.75)
                    .attr('ry', '1.0em');
            }
            if (k == 'action') {
                container
                    .attr('y', '-0.85em')
                    .attr('x', -width/2.0)
                    .attr('width', width)
                    .attr('height', '1.75em');
            }
        }
    });
}

// LoadTree parses _str_ into a root tree node and renders it.
function loadTree(str) {
    let result = parse(str),
        line   = result.line;
    if (result.error) {
        console.error(`Line ${line}: ${result.error}`);
        return;
    }

    const width     = 1000,
          svgParent = 'main';

    let x0   = Infinity,
        x1   = -x0,
        data = d3.hierarchy(result.root);

    data.dx = 8;
    data.dy = width / (data.height + 3);

    let root = d3.tree().nodeSize([4*data.dx, data.dy])(data);
    root.each(d => {
        if (d.x > x1) x1 = d.x;
        if (d.x < x0) x0 = d.x;
    });

    let conds = d3.select('#tree-conditions')
        .html('')
        .selectAll('a')
        .data(Object.keys(result.conditions).sort())
        .enter()
        .append('a')
        .classed('mdl-navigation__link', true);

    let condLabels = conds.append('label')
        .attr('for', function(d, i) { return `switch-${i}`; });
    
    condLabels.append('input')
        .attr('type', 'checkbox')
        .attr('id', function(d, i) { return `switch-${i}`; })
        .classed('mdl-switch__input', true)
        .on('change', function(name) {
            let s = d3.event.target.checked ? SUCCESS : FAILED;
            result.conditions[name].forEach(c => c.status = s);
            render();
        });
    condLabels
        .classed('mdl-switch mdl-js-switch mdl-js-ripple-effect', true);
    condLabels.append('span')
        .classed('mdl-switch__label', true)
        .text(name => name);
    // Force the material library to call the JS on all label
    // elements; otherwise, if loading a new tree the switches will
    // appear as checkboxes.
    condLabels.each(function(d) {
        let label = d3.select(this).node();
        componentHandler.upgradeElement(label);
    });

    const BTN_CLASS = 'mdl-button mdl-js-button mdl-button--fab tree-action--mini-fab mdl-js-ripple-effect';

    let actions = d3.select('#tree-actions')
        .html('')
        .selectAll('a')
        .data(Object.keys(result.actions).sort())
        .enter()
        .append('a')
        .classed('mdl-navigation__link tree-action', true);
    actions.append('span')
        .text(name => name);

    let actionBtns = actions.append('div');

    let clear = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--failure', true)
        .on('click', function(name) {
            result.actions[name].forEach(a => a.status = FAILED);
            render();
        });
    clear
        .append('i')
        .classed('material-icons', true)
        .text('clear');
    clear.each(function(d) {
        let btn = d3.select(this).node();
        componentHandler.upgradeElement(btn);
    });

    let add = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--success', true)
        .on('click', function(name) {
            result.actions[name].forEach(a => a.status = SUCCESS);
            render();
        });
    add
        .append('i')
        .classed('material-icons', true)
        .text('add');
    add.each(function(d) {
        let btn = d3.select(this).node();
        componentHandler.upgradeElement(btn);
    });

    let run = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--running', true)
        .on('click', function(name) {
            result.actions[name].forEach(a => a.status = RUNNING);
            render();
        });
    run
        .append('i')
        .classed('material-icons', true)
        .text('play_arrow');
    run.each(function(d) {
        let btn = d3.select(this).node();
        componentHandler.upgradeElement(btn);
    });

    function render() {
        root.data.deactivate();
        root.data.tick();
        renderTree('main', root, width, x0, x1);
    }
    render();
}

(function main() {
    let treeSelect = document.getElementById('treeFileSelect'),
        treeInput  = document.getElementById('treeFileInput');

    treeInput.addEventListener('change', function() {
        if (this.files.length < 1) {
            return;
        }
        let reader = new FileReader();
        reader.onload = function(e) {
            loadTree(e.target.result);
        };
        reader.readAsText(this.files[0]);
    }, false);

    treeSelect.addEventListener('click', function(e) {
        if (treeInput) {
            treeInput.click();
        }
    }, false);

    loadTree(SAMPLE_TREE);
})();
