//@ts-check

let btree = require('../btree').bt;
let expect = require('chai').expect;
let fs = require('fs');

describe('README.md samples', () => {
    it('runs all samples from README.md', () => {

        let fenceStart = new RegExp(/^```(.+)$/, "gm");
        let fenceEnd = new RegExp(/^```$/, "gm");

        let readme = fs.readFileSync('./README.md', { encoding: 'utf8' });
        /** @type {RegExpExecArray} */
        let startMatch = null;
        while ((startMatch = fenceStart.exec(readme)) !== null) {
            let language = startMatch[1];
            let fencedTextStartIdx = startMatch.index + startMatch[0].length + 1;
            fenceEnd.lastIndex = fencedTextStartIdx;

            let endMatch = fenceEnd.exec(readme);
            if (endMatch === null) {
                break;
            }
            fenceStart.lastIndex = endMatch.index + endMatch[0].length + 1;
            let fencedText = readme.substring(fencedTextStartIdx, endMatch.index);
            console.log(`${language}: ${fencedText}`);
            checkSample(language, fencedText);
        }

    });
})

/**
 * Check the code sample
 * @param {string} language code language
 * @param {string} sampleCode
 */
function checkSample(language, sampleCode) {
    switch (language.toLowerCase()) {
        case 'tree':
            let tree = btree.parse(sampleCode);
            expect(tree.root).to.be.not.null;
            expect(tree.error, `there should be no error in tree sample ${sampleCode}`).to.be.null;
            break;
        case 'javascript':
            const runSample = () => {
                eval(sampleCode);
            }
            expect(runSample, `sample: ${sampleCode}`).to.not.throw();
            break;
        default:
            console.warn(`Language ${language} not supported for checking.`);
    }
}

describe('#parse', () => {

    context('valid input', () => {
        it('parses sample', () => {
            let tree = btree.parse(btree.SAMPLE_TREE);
            expect(tree.root).to.be.not.null;
            expect(tree.error).to.be.null;
            expect(tree.conditions.get('Ghost Scared')).to.have.length(2);
            expect(tree.actions.get('Avoid Ghost')).to.have.length(1);
        });
    });

    context('for single-node tree', () => {
        it('parses fallback', () => {
            let tree = btree.parse(`?`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.FALLBACK);
        });

        it('parses sequence', () => {
            let tree = btree.parse(`->`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.SEQUENCE);
        });

        it('parses parallel', () => {
            let count = 12;
            let tree = btree.parse(`=${count}`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.PARALLEL);
            /** @type {btree.Parallel} */
            let actualParallel = tree.root;
            expect(actualParallel.successCount).to.be.equal(count);
        });

        it('parses condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses negated condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(true);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses double-negated condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`!!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses action', () => {
            let actionName = 'action name';
            let tree = btree.parse(`[${actionName}]`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.ACTION);
            expect(tree.root.name).to.be.equal(actionName);
            expect(tree.actions.get(actionName)).to.be.deep.equal([tree.root]);
        });
    });

    context('for invalid input', () => {
        it('returns error for empty string', () => {
            let tree = btree.parse('');
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double root', () => {
            let tree = btree.parse(`->
                |   (some condition)
                ->
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double indent (orphan tree branches)', () => {
            let tree = btree.parse(`->
                |   |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("indentation", "there should be error message");
        });

        it('returns error for child of condition', () => {
            let tree = btree.parse(`(condition)
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for child of action', () => {
            let tree = btree.parse(`[action]
                |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for lack of root tree level', () => {
            let tree = btree.parse(`|   [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("no parent", "there should be error message");
        });

        // todo: decide whether the syntax should allow this
        it.skip('returns error for two nodes on the same line', () => {
            let tree = btree.parse(`->  [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });
    });
});

describe("BehaviorTree", () => {
    describe("#fromJson", () => {
        it('builds tre from JSON)', () => {
            let tree = btree.BehaviorTree.fromJson(JSON.parse(`{
                "root":{
                    "name": "Avoid Ghost",
                    "kind": "action",
                    "children": null,
                    "active": false,
                    "wasActive": false,
                    "nodeStatus": 2,
                    "hasNot": false
                }
            }`));
            expect(tree.root.kind).to.be.equal(btree.ACTION);
        });

        it('parses sample and re-hydrates it from JSON', () => {
            let tree = btree.parse(btree.SAMPLE_TREE);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = btree.BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(JSON.stringify(actualTree)).equal(treeAsString);
        });

        it('re-hydrates true condition from JSON with correct value', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`(${conditionName})`);
            tree.setConditionStatus(conditionName, btree.SUCCESS);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = btree.BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(btree.SUCCESS, "condition value should be SUCCESS");
        });

        it('re-hydrates a running action from JSON with correct status', () => {
            let actionName = 'action1';
            let tree = btree.parse(`[${actionName}]`);
            tree.setActionStatus(actionName, btree.RUNNING);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = btree.BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(btree.RUNNING, "action status should be RUNNING");
            expect(actualTree.root.active()).equal(true, "action status should be 'active'");
        });
    });

    describe('#tick', () => {
        it('notify about action activation when ticked', () => {
            let action1 = btree.action("action1");
            let tree = new btree.BehaviorTree(action1, 0, undefined);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(btree.RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in parsed tree)', () => {
            let tree = btree.parse(`[a]`);
            expect(tree.root.kind).to.be.equal(btree.ACTION);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(btree.RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in JSON tree)', () => {
            let tree = btree.BehaviorTree.fromJson(JSON.parse(`{
                "root":{
                    "name": "Avoid Ghost",
                    "kind": "action",
                    "children": null,
                    "active": false,
                    "wasActive": false,
                    "nodeStatus": 2,
                    "hasNot": false
                }
            }`));
            expect(tree.root.kind).to.be.equal(btree.ACTION);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(btree.RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });


        it('executes a sample parsed tree', () => {
            let tree = btree.parse(`
            ?
            |   !(have hunger)
            |   [eat]`);

            // subscribe to action activation
            tree.onActionActivation(actionNode => {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(btree.getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', btree.FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', btree.SUCCESS);
                        }
                }
            });
            tree.root.tick();
            
            console.log('Initial state:');
            console.log(btree.getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true
            
            // then we get hunger
            tree.setConditionStatus('have hunger', btree.SUCCESS);
            let statusAfterHungerIsTrue = tree.root.tick();
            console.log(btree.getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(btree.getFriendlyStatus(tree.root.status())); // prints 'success'
        });

        it('executes a sample coded tree', () => {

            // define the action 'eat' implementation
            let onEat = function (actionNode) {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(btree.getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', btree.FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', btree.SUCCESS);
                        }
                }
            };

            // ?
            // |   !(have hunger)
            // |   [eat]`

            let rootNode = btree.fallback([
                btree.condition("have hunger", true),
                btree.action("eat", onEat)
            ]);
            let tree = new btree.BehaviorTree(rootNode);

            tree.root.tick();
            
            console.log('Initial state:');
            console.log(btree.getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true
            
            // then we get hunger
            tree.setConditionStatus('have hunger', btree.SUCCESS);
            let statusAfterHungerIsTrue = tree.root.tick();
            console.log(btree.getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(btree.getFriendlyStatus(tree.root.status())); // prints 'success'
        });

    });
});

describe('#fallback', () => {
    it('resolves to FAILED when no children', () => {
        let tree = btree.parse(`?`);
        expect(tree.root).to.be.not.null;
        expect(tree.root.kind).to.be.equal(btree.FALLBACK);
        // when
        tree.root.tick();
        expect(tree.root.status()).equal(btree.FAILED);
    });
});

describe('Action', () => {
    describe('#tick', () => {
        it('runs action when ticked', () => {
            let action1 = btree.action("action1", actionNode => actualActivatedAction = actionNode);
            // when
            let actualActivatedAction = null;
            action1.tick();
            // then
            expect(action1.status()).equal(btree.RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedAction).deep.equal(action1);
        });
    });

    describe('#wasActive', () => {
        it('re-activates previously active action', () => {
            let action1 = btree.action("action1", actionNode => actualActivatedActions.push(actionNode));
            // when
            let actualActivatedActions = [];
            action1.tick();
            // then
            expect(action1.status()).equal(btree.RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedActions).contains(action1);
            // when .. action is finished
            action1.setStatus(btree.FINISHED);
            action1.deactivate(); // simulate that another tree branch became active
            // then
            expect(action1.status()).equal(btree.FINISHED);
            expect(action1.active()).equal(false);
            expect(action1.wasActive).equal(true);
        });
    });
});
