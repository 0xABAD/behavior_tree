const FAILED  = 0,
      SUCCESS = 1,
      RUNNING = 2;

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

function parseParallel(buf, i) {
    let num = '';
    while (i < buf.length) {
        let ch = buf[i];
        let m = ch.match(/\d/);
        if (m && m.length == 1) {
            num += ch;
        } else {
            break;
        }
        i++;
    }
    if (num == '') {
        return [0, i, 'Expecting number after parallel node.'];
    }
    num = parseInt(num);
    if (num == 0) {
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
    let fb = node('?', 'fallback', []);    
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
    let seq = node('\u2192', 'sequence', []);
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
    let par = node('=', 'parallel', []);
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
    let a = node(name, 'action');
    a.setStatus(RUNNING);
    return a;
}

function condition(name) { return node(name, 'condition'); }

function parse(buf) {
    let indent     = 0,      // current recorded indentation
        line       = 1,      // line number in text
        nodes      = [null], // node tree
        actions    = {},     // unique action nodes
        conditions = {},     // unique condition nodes
        notPending = false,  // is 'not' decorator waiting to be applied?
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
                return `${parent.kind} node can't have child nodes`;
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
        let ch     = buf[i],
            notNow = false;
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
            if (notPending) {
                notPending = false;
                c.hasNot = true;
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

    return { root: nodes[0], line, actions, conditions, error: null };
}

// Render _root_ inside the _parent_ DOM node with a viewbox width
// of _width_.  _x0_ and _x1_ are used to determine the vertical height
// of the tree inside the viewbox.
function renderTree(parent, root, width, x0, x1) {
    function translate(tree) {
        let x = tree.dy + tree.drag_dx,
            y = tree.dx - x0 + tree.drag_dy;
        return `translate(${x}, ${y}) scale(${root.scale})`;
    }

    const svg = d3.select(parent)
          .html('')
          .append('svg')
          .attr('width', '100%')
          .attr('height', '100%')
          .attr('viewBox', [0, 0, width, x1 - x0 + root.dx * 4]);
    
    const g = svg.append('g')
          .attr('font-family', 'sans-serif')
          .attr('font-size', 12)
          .attr('transform', translate(root));

    svg.call(d3.drag().on('drag.svg', function() {
        root.drag_dy += d3.event.dy;
        root.drag_dx += d3.event.dx;
        g.attr('transform', translate(root));
    }));
    
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

        if (k == 'sequence' || k == 'fallback' || k == 'parallel') {
            let color      = nodeColor(active, d.data.status()),
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
                color      = nodeColor(active, d.data.status()),
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

            let name = d.data.name;
            if (d.data.hasNot) {
                name = '!' + name;
            }
            let text = d3.select(this)
                .append('text')
                .attr('dy', '0.31em')
                .attr('text-anchor', 'start')
                .attr('fill', text_color)
                .text(name)
                .clone(true).lower()
                .node();

            let width = text.getComputedTextLength() + PAD;
            if (k == 'condition') {
                container
                    .attr('cx', width/2.0 - PAD/2.0)
                    .attr('rx', width/1.75)
                    .attr('ry', '1.0em');
            }
            if (k == 'action') {
                container
                    .attr('y', '-0.85em')
                    .attr('x', -PAD/2.0)
                    .attr('width', width)
                    .attr('height', '1.75em');
            }
        }
    });
}

function clamp(val, min, max) {
    if (val < min) {
        return min;
    }
    if (val > max) {
        return max;
    }
    return val;
}

function windowSize() {
    let w = window,
        d = document,
        e = d.documentElement,
        g = d.getElementsByTagName('body')[0],
        x = w.innerWidth || e.clientWidth || g.clientWidth,
        y = w.innerHeight || e.clientHeight || g.clientHeight;
    return [x, y];
}

// LoadTree parses _str_ into a root tree node and renders it.
function loadTree(str) {
    let result = parse(str),
        line   = result.line;
    if (result.error) {
        d3.select('main')
            .html('')
            .append('div')
            .classed('tree-error__container', true)
            .append('span')
            .classed('tree-error__text', true)
            .text(`Line ${line}: ${result.error}`);
        return;
    }

    let x0   = Infinity,
        x1   = -x0,
        data = d3.hierarchy(result.root),
        root = undefined,
        horizontal_stretch = 0,
        vertical_stretch   = 8,
        [width, height]    = windowSize();

    data.drag_dx = 0;
    data.drag_dy = 0;
    data.scale = 1;

    function resizeRoot() {
        data.dx = vertical_stretch;
        data.dy = (width + horizontal_stretch) / (data.height + 3);

        root = d3.tree().nodeSize([4*data.dx, data.dy])(data);
        root.each(d => {
            if (d.x > x1) x1 = d.x;
            if (d.x < x0) x0 = d.x;
        });
    }
    resizeRoot();

    window.addEventListener('resize', function() {
        [width, height] = windowSize();
        resizeRoot();
        render();
    });

    d3.select('main')
        .on('wheel', function() {
            let e = d3.event;
            let up = false;

            if (e.deltaY == 0) {
                return;
            }
            if (e.deltaY < 0) {
                up = true;
            }
            if (e.shiftKey && e.ctrlKey) {
                vertical_stretch += up ? 1 : -1;
                vertical_stretch = clamp(vertical_stretch, 6, 1000);
            } else if (e.shiftKey) {
                horizontal_stretch += up ? 30 : -30;
                horizontal_stretch = clamp(horizontal_stretch, -width*0.6, 1000.0);
            } else {
                data.scale += up ? 0.10 : -0.10;
                data.scale = clamp(data.scale, 0.10, 100.0);
            }
            resizeRoot();
            render();
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
            result.conditions[name].forEach(c => c.setStatus(s));
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
            result.actions[name].forEach(a => a.setStatus(FAILED));
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
            result.actions[name].forEach(a => a.setStatus(SUCCESS));
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
            result.actions[name].forEach(a => a.setStatus(RUNNING));
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
