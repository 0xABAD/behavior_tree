//@ts-check

let express = require('express');
let bodyParser = require('body-parser');
let cors = require('cors');
let fs = require('fs');
const yargs = require('yargs');
const http = require('http');
const { BehaviorTree, Action, SUCCESS, FAILED } = require('./btree').bt;

const argv = yargs
    .option('config', {
        description: 'Loads configuration file with action name to behavior tree map',
        type: 'string',
    })
    .option('port', {
        description: 'Port number on which to listen',
        type: 'count',
    })
    .option('downstream', {
        description: 'Downstream control system or simulator URL to call when BT activates an action',
        type: 'string',
        default: 'http://localhost:16462'
    })
    .help()
    .argv;

let actionToBehaviorTreeMap = {};
if (argv.config) {
    actionToBehaviorTreeMap = JSON.parse(fs.readFileSync(argv.config, { encoding: "utf8" }));
}

let downstreamControlSystemUrl = argv.downstream;
console.log(`Downstream system: ${downstreamControlSystemUrl}`);

let app = express();
let port = argv.port || process.env.PORT || 16461;

/** @type {Map<string, BehaviorTree>} keeps track of all the active trees mapping actionName -> tree */
let trees = new Map();

/** Incremental counter of trees. Used to assign a unique ID to each tree. */
let treeCounter = 0;

/** @type {Map<number, string>} keeps track of all the active trees mapping actionName -> tree */
let treeOwners = new Map();

/** @type {Map<string, boolean|number>} State representation. */
const state = new Map();


app.use(bodyParser.json());

app.get('/', (req, res, next) => {
    res.json({ "message": "Behavior Tree run-time" });
});

// return all trees
app.options('/trees', cors({ origin: "*" }));
app.get('/trees', cors({ origin: "*" }), (req, res, next) => {
    res.json(strMapToObj(trees));
});

// returns the tree
app.get('/tree/:fullActionName', (req, res, next) => {
    let fullActionName = req.params.fullActionName;

    if (!trees.has(fullActionName)) {
        res.status(404).end();
    }
    else {
        let tree = trees.get(fullActionName);
        res.json(tree);
    }
});

// returns state of the tree root node
app.get('/tree/:fullActionName/status', (req, res, next) => {
    let fullActionName = req.params.fullActionName;

    if (!trees.has(fullActionName)) {
        res.status(404).end();
    }
    else {
        let tree = trees.get(fullActionName);
        res.json({ "status": tree.root.status() });
    }
});

app.post('/start', (req, res, next) => {
    // console.log(`Starting: ${JSON.stringify(req.body)}`);
    let owner = req.body['ToActor'];
    let actionName = req.body['Action'];
    let fullActionName = createFullActionName(req.body);

    if (trees.has(fullActionName)) {
        res.status(409).send(`Action '${fullActionName}' is already running. Self-overlapping actions are not supported.`);
        return;
    }

    console.log(`Starting action ${fullActionName}`);

    if (actionToBehaviorTreeMap && actionToBehaviorTreeMap[actionName] ||
        fs.existsSync(actionName + '.tree')) {
        // tree is specified for this action or implicit mapping to file name exists
        let treeFileName = actionToBehaviorTreeMap[actionName] || actionName + '.tree';
        fs.readFile(treeFileName, { encoding: 'utf8' }, (err, data) => {
            if (err) {
                console.error(`Could not load file '${treeFileName}'.`);
                res.status(404).end();
            }
            else {
                console.log(`Loaded ${treeFileName}.`);
                let tree = BehaviorTree.fromText(data);
                if (tree.error) {
                    console.log(`Invalid tree in ${treeFileName}: ${data}`);
                    res.status(500).end();
                }
                else {
                    activate(owner, fullActionName, tree);
                    res.status(202).end();
                }
            }
        });
    }
    else {
        // no tree is available for this action, pass it downstream
        sendActionStartDownstream(owner, actionName);
    }
});

/**
 * Initializes the tree
 * @param {string} owner 
 * @param {string} fullActionName 
 * @param {BehaviorTree} tree 
 */
function activate(owner, fullActionName, tree) {
    tree.onActionActivation((/** @type {Action} */ action) => startAction(tree, action));
    tree.setId(treeCounter++);
    // update the initial state of the tree to reflect the current state
    [...tree.conditions.keys()].forEach(conditionName => {
        
        if (state.has(conditionName)) {
            let value = state.get(conditionName);
            let status = conditionValueToStatus(value);
            tree.setConditionStatus(conditionName, status);
        }
    });
    // console.log(JSON.stringify(tree));
    trees.set(fullActionName, tree);
    treeOwners.set(tree.getId(), owner)
    // activate the tree
    tree.tick();
}

app.post('/stop', (req, res, next) => {
    let actionName = req.body['Action'];
    let fullActionName = createFullActionName(req.body);
    console.log(`Stopping action '${fullActionName}'`);
    if (trees.has(fullActionName)) {
        trees.delete(fullActionName);
        // todo: perhaps a message to the downstream system?
    }
    res.status(202).end();
});

app.post('/update', (req, res) => {
    let atomicsValues = req.body['Atomics'];
    console.log(`Updated atomics values ${JSON.stringify(atomicsValues)}`);

    updateState(atomicsValues);
    trees.forEach(tree => updateTree(tree, atomicsValues));

    res.status(202).end();
});

app.listen(port, () => console.log('Listening on port: ' + port))
    .on("error", err => console.error(err));

/**
 * Creates a full action name
 * @param {any} action action JSON
 */
function createFullActionName(action) {
    let actionName = action['Action'];
    let parameters = action['Params'];
    return parameters.length ?
        `${actionName} ${parameters.join(' ')}` :
        actionName;
}

/**
 * Updates the tree with changed values
 * @param {BehaviorTree} tree behavior tree to update
 * @param {Map<string, number | boolean>} conditionValues new condition values 
 * @returns {void}
 */
function updateTree(tree, conditionValues) {
    Object.keys(conditionValues).forEach(conditionName => {
        if (tree.conditions.has(conditionName)) {
            let value = conditionValues[conditionName];
            let status = conditionValueToStatus(value);
            tree.setConditionStatus(conditionName, status);
        }
    });
}

/**
 * Updates state cache.
 * @param {Map<string, number | boolean>} conditionValues new condition values 
 * @returns {void}
 */
function updateState(conditionValues) {
    Object.keys(conditionValues).forEach(conditionName => {
        let value = conditionValues[conditionName];
        state.set(conditionName, value);
    });
}

/**
 * Converts condition value to BehaviorTree node status
 * @param {boolean | number} value condition value
 * @returns {number} BehaviorTree node status
 */
function conditionValueToStatus(value) {
    switch (value) {
        case true:
            return SUCCESS;
        case false:
            return FAILED;
        default:
            throw new Error(`Condition value not supported: ${value}`);
    }
}

/**
 * Posts the action-start event to the downstream controller or simulator.
 * @param {BehaviorTree} tree behavior tree
 * @param {Action} action action that was activated in a tree
 * @returns {void}
 */
function startAction(tree, action) {
    if (action.active()) {
        let toActor = treeOwners.get(tree.getId());
        sendActionStartDownstream(toActor, action.name);
    }
}

function sendActionStartDownstream(toActor, actionName) {
    const actionStartJson = {
        "ToActor": toActor,
        "FromActor": "",
        "Action": actionName,
        "Params": [
            // {
            //     "Name": "world",
            //     "Type": "thing",
            //     "Value": 1
            // },
        ],
    }
    const actionStartText = JSON.stringify(actionStartJson);
    const req = http.request(downstreamControlSystemUrl + '/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': actionStartText.length
        }
    }, res => {
        if (res.statusCode >= 300) {
            console.error(`Action start failed by ${downstreamControlSystemUrl} with code ${res.statusCode}.`);
        }
    }).on('error', err => {
        console.error(`Action start failed with error ${err}.`);
    });

    req.write(actionStartText)
    req.end();
}


//https://2ality.com/2015/08/es6-map-json.html
function strMapToObj(strMap) {
    let obj = Object.create(null);
    for (let [k, v] of strMap) {
        // We don’t escape the key '__proto__'
        // which can cause problems on older engines
        obj[k] = v;
    }
    return obj;
}

console.log(`
██████╗ ███████╗██╗  ██╗ █████╗ ██╗   ██╗██╗ ██████╗ ██████╗     ████████╗██████╗ ███████╗███████╗
██╔══██╗██╔════╝██║  ██║██╔══██╗██║   ██║██║██╔═══██╗██╔══██╗    ╚══██╔══╝██╔══██╗██╔════╝██╔════╝
██████╔╝█████╗  ███████║███████║██║   ██║██║██║   ██║██████╔╝       ██║   ██████╔╝█████╗  █████╗  
██╔══██╗██╔══╝  ██╔══██║██╔══██║╚██╗ ██╔╝██║██║   ██║██╔══██╗       ██║   ██╔══██╗██╔══╝  ██╔══╝  
██████╔╝███████╗██║  ██║██║  ██║ ╚████╔╝ ██║╚██████╔╝██║  ██║       ██║   ██║  ██║███████╗███████╗
╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝       ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
                                                                                                  
`);
