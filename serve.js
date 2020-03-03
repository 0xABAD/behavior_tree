//@ts-check

let express = require('express');
let bodyParser = require('body-parser');
let cors = require('cors');
let fs = require('fs');
const yargs = require('yargs');
const http = require('http');
const { BehaviorTree, parse, Action, SUCCESS, FAILED } = require('./btree').bt;

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

let app = express();
let port = argv.port || process.env.PORT || 16461;

let trees = new Map();

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
    let actionName = req.body['Action'];
    let parameters = req.body['Params'];
    let fullActionName = parameters.length ?
        `${actionName} ${parameters.join(' ')}` :
        actionName;

    if (trees.has(fullActionName)) {
        res.status(409).send(`Action '${fullActionName}' is already running. Self-overlapping actions are not supported.`);
        return;
    }

    console.log(`Starting action ${fullActionName}`);

    let treeFileName = actionToBehaviorTreeMap[actionName] || actionName + '.tree';
    fs.readFile(treeFileName, { encoding: 'utf8' }, (err, data) => {
        if (err) {
            console.error(`Could not load file ${treeFileName}.`);
            res.status(404).end();
        }
        else {
            console.log(`Loaded ${treeFileName}.`);
            let tree = parse(data);
            tree.onActionActivation((/** @type {Action} */ action) => startAction(tree, action));
            console.log(JSON.stringify(tree));
            trees.set(fullActionName, tree);
            res.status(202).end();
        }
    });
});

app.post('/stop', (req, res, next) => {
    let actionName = req.body['Action'];
    let parameters = req.body['Params'];
    console.log(`Stopping action ${actionName} ${parameters.join(' ')}`);
    res.status(202).end();
});

app.post('/update', (req, res) => {
    let atomicsValues = req.body['Atomics'];
    console.log(`Updated atomics values ${JSON.stringify(atomicsValues)}`);

    trees.forEach(tree => updateTree(tree, atomicsValues));

    res.status(202).end();
});

app.post("/planupdate", (req, res) => {
    console.log(`Updated plan ${JSON.stringify(req.body)}`);
    res.status(202).end();
});


app.listen(port, () => console.log('Listening on port: ' + port))
    .on("error", err => console.error(err));

/**
 * Updates the tree with changed values
 * @param {BehaviorTree} tree behavior tree to update
 * @param {Map<string, number | boolean>} conditionValues new condition values 
 * @returns {void}
 */
function updateTree(tree, conditionValues) {
    Object.keys(conditionValues).forEach(conditionName => {
        let value = conditionValues[conditionName];
        let status = conditionValueToStatus(value);
        tree.setConditionStatus(conditionName, status);
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
        const actionStartJson = {
            "ToActor": "downstream",
            "FromActor": "",
            "Action": action.name,
            "Params": [
                // {
                //     "Name": "world",
                //     "Type": "thing",
                //     "Value": 1
                // },
            ],
        }
        const actionStartText = JSON.stringify(actionStartJson);
        const req = http.request(downstreamControlSystemUrl, {
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