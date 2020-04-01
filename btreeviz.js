
if (typeof (require) === typeof (Function)) {
    // only load the dependency during development time to get dev support
    d3 = require("d3@^5.15")
    bt = require('./btree')
}

/**
 * Render _root_ inside the _parent_ DOM node with a viewbox width
 * of _width_.  _x0_ and _x1_ are used to determine the vertical height
 * of the tree inside the viewbox.
 * @param {string} parent HTML element type
 * @param {Rl} root D3 hierarchy tree root node
 * @param {number} width 
 * @param {number} x0 
 * @param {number} x1 
 * @param {(node: Node, shiftKey: boolean): void} onDoubleClick double-click callback
 * @param {(node: Node): void} onRightClick right callback
 */
function renderTree(parent, root, width, x0, x1, onDoubleClick=undefined, onRightClick=undefined) {
    function translate(tree) {
        let x = tree.dy + tree.drag_dx,
            y = tree.dx - x0 + tree.drag_dy;
        return `translate(${x}, ${y}) scale(${root.scale})`;
    }

    const svg = d3.select(parent)
          .html('')
          .append('svg')
          .attr('width', '100vw')
          .attr('height', '100vh')
          .attr('viewBox', [0, 0, width, x1 - x0 + root.dx * 4]);
    
    const g = svg.append('g')
          .attr('font-family', 'sans-serif')
          .attr('font-size', 12)
          .attr('transform', translate(root));

    svg.call(d3.drag().on('drag.svg', function() {
        let s = clamp(root.scale, 1.0, root.scale);
        root.drag_dy += d3.event.dy * s;
        root.drag_dx += d3.event.dx * s;
        g.attr('transform', translate(root));
    }));
    
    const lineOpacity = 0.8;

    const link = g.append('g')
          .attr('fill', 'none')
          .attr('stroke-opacity', lineOpacity)
          .selectAll('path')
          .data(root.links())
          .join('path')
          .attr('stroke-width', e => e.target.data.active() ? 2 : 1)
          .attr('d', d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x))
            .attr('stroke', e => {
            return nodeColor(e.target.data.active(), e.target.data.status());
        });
    
    const node = g.append('g')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-opacity', lineOpacity)
          .attr('stroke-width', 1.5)
          .selectAll('g')
          .data(root.descendants())
          .join('g')
          .attr('transform', d => `translate(${d.y},${d.x})`);

    function nodeColor(active, status) {
        const base = 'CC';
        const amp1 = '66';
        const amp2 = '22';

        switch (status) {
            case SUCCESS:
                return `#${amp1}${base}${amp2}`; 
            case RUNNING:
                return `#${amp2}${amp1}${base}`; 
            case FAILED:  
                return `#${base}${amp1}${amp2}`; 
            default:
                return `#${base}${base}${base}`; 
        }
    }

    node.each(function(d) {
        /** @type {boolean} */
        const active = d.data.active();
        /** @type {string} */
        const k      = d.data.kind;

        if (k === SEQUENCE || k === FALLBACK || k === PARALLEL) {
            const color = nodeColor(active, d.data.status());
            const fill = active ? color : 'white';
            const text_color = active ? 'white' : 'black';

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
                .attr('x', d => d.data.kind == SEQUENCE ? 5 : 3)
                .attr('text-anchor', 'end')
                .text(d.data.name)
                .attr('fill', text_color)
                .clone(true).lower();
        }

        if (k == CONDITION || k == ACTION) {
            let container;
            const color = nodeColor(active, d.data.status());
            const fill = active ? color : 'white';
            const text_color = active ? 'white' : 'black';

            if (k == CONDITION) {
                container = d3.select(this).append('ellipse');
            }
            if (k == ACTION) {
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
                // add double-click handler
                .on('dblclick', n => {
                    if (onDoubleClick) {
                        onDoubleClick(n.data, d3.event.shiftKey);
                    }
                })
                // add right-click handler
                .on('contextmenu', n => {
                    if (onRightClick) {
                        d3.event.preventDefault();
                        onRightClick(n.data);
                    }
                })
                .text(name)
                .clone(true).lower()
                .node();

            const width = text.getComputedTextLength() + PAD;
            if (k == CONDITION) {
                container
                    .attr('cx', width/2.0 - PAD/2.0)
                    .attr('rx', width/1.75)
                    .attr('ry', '1.0em');
            }
            if (k == ACTION) {
                container
                    .attr('y', '-0.85em')
                    .attr('x', -PAD/2.0)
                    .attr('width', width)
                    .attr('height', '1.75em');
            }
        }

        // node tooltip
        const status = getFriendlyStatus(d.data.status());
        d3.select(this)
            .append("svg:title")
            .text(d => `Node: ${d.data.hasNot?"NOT ": ""}${d.data.name} ${k}\nActive: ${active}\nStatus: ${status}`);
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

function showError(message, parent) {
    d3.select(parent)
            .html('')
            .append('div')
            .classed('tree-error__container', true)
            .append('span')
            .classed('tree-error__text', true)
            .text(message);
}

/**
 * Parses and shows the supplied tree.
 * @param {string} str behavior tree as string
 * @param {string} parent name of hosting HTML element
 * @param {(node: Node, shiftKey: boolean): void} onDoubleClick double-click callback
 * @param {(node: Node): void} onRightClick right callback
 * @returns {void}
 */
function loadTree(str, parent, onDoubleClick=undefined, onRightClick=undefined) {
    let tree = parse(str),
        line = tree.line;
    if (tree.error) {
        showError(`Line ${line}: ${tree.error}`, parent);
        return;
    }

    showTree(tree, parent, onDoubleClick, onRightClick);
}

/**
 * Populates the page with the behavior _tree_ and condition and action control elements.
 * @param {BehaviorTree} tree behavior tree
 * @param {string} parent name of hosting HTML element
 * @param {(node: Node, shiftKey: boolean): void} onDoubleClick double-click callback
 * @param {(node: Node): void} onRightClick right callback
 * @returns {() => void} render function for programmatic view refresh
 */
function showTree(tree, parent, onDoubleClick=undefined, onRightClick=undefined) {
    let x0 = Infinity,
        x1 = -x0,
        data = d3.hierarchy(tree.root),
        horizontal_stretch = 0,
        vertical_stretch   = 8,
        [width, height]    = windowSize();

    /** @type {d3.TreeLayout<bt.Node>} */
    root = undefined

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

    d3.select(parent)
        .on('wheel', function() {
            let e = d3.event;
            let up = false;

            if (e.deltaY == 0) {
                return;
            }
            if (e.deltaY < 0) {
                up = true;
            }
            if (e.shiftKey && e.altKey) {
                vertical_stretch += up ? 1 : -1;
                vertical_stretch = clamp(vertical_stretch, 3, 1000);
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
        .data([...tree.conditions.keys()].sort())
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
            tree.setConditionStatus(name, s);
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
        .data([...tree.actions.keys()].sort())
        .enter()
        .append('a')
        .classed('mdl-navigation__link tree-action', true);
    actions.append('span')
        .text(name => name);

    let actionBtns = actions.append('div');

    let fail = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--failure', true)
        .attr('title', name => "Set action '" + name + "' as failed")
        .on('click', function(name) {
            tree.setActionStatus(name, FAILED);
            render();
        });
    fail
        .append('i')
        .classed('material-icons', true)
        .text('clear');
    fail.each(function(d) {
        let btn = d3.select(this).node();
        componentHandler.upgradeElement(btn);
    });

    let succeed = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--success', true)
        .attr('title', name => "Set action '" + name + "' as succeeded")
        .on('click', function(name) {
            tree.setActionStatus(name, SUCCESS);
            render();
        });
    succeed
        .append('i')
        .classed('material-icons', true)
        .text('add');
    succeed.each(function(d) {
        let btn = d3.select(this).node();
        componentHandler.upgradeElement(btn);
    });

    let run = actionBtns.append('button')
        .classed(BTN_CLASS, true)
        .classed('tree-action--running', true)
        .attr('title', name => "Start '" + name + "' action")
        .on('click', function(name) {
            tree.setActionStatus(name, RUNNING);
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
        renderTree(parent, root, width, x0, x1, onDoubleClick, onRightClick);
    }
    render();

    return render;
}

function main(parentElement) {
    let treeSelect = document.getElementById('treeFileSelect'),
        treeInput  = document.getElementById('treeFileInput');

    treeInput.addEventListener('change', function() {
        if (this.files.length < 1) {
            return;
        }
        let reader = new FileReader();
        reader.onload = function(e) {
            loadTree(e.target.result, parentElement, undefined);
        };
        reader.readAsText(this.files[0]);
    }, false);

    treeSelect.addEventListener('click', function(e) {
        if (treeInput) {
            treeInput.click();
        }
    }, false);

    d3.select('#tree-help__button')
        .on('click', function() {
            let card = d3.select('#tree-help__card'),
                viz  = card.style('visibility');
            if (viz == 'hidden') {
                viz = 'visible';
            } else {
                viz = 'hidden';
            }
            card.style('visibility', viz);
        });

    loadTree(SAMPLE_TREE, parentElement, undefined, undefined);
}
