//@ts-check

const expect = require('chai').expect;
const fs = require('fs');
const { BehaviorTree, parse,
    Fallback, Sequence, Parallel, Action, Condition,
    FALLBACK, SEQUENCE, PARALLEL, ACTION, CONDITION,
    fallback, sequence, parallel, action, condition,
    SUCCESS, FAILED, RUNNING,
    SAMPLE_TREE, getFriendlyStatus,
    parseComment } = require('../index');

describe('README.md samples', () => {
    it('runs all samples from README.md', () => {

        const fenceStart = new RegExp(/^```(.+)$/, "gm");
        const fenceEnd = new RegExp(/^```$/, "gm");

        const readme = fs.readFileSync('./README.md', { encoding: 'utf8' });
        /** @type {RegExpExecArray} */
        let startMatch = null;
        while ((startMatch = fenceStart.exec(readme)) !== null) {
            const language = startMatch[1];
            const fencedTextStartIdx = startMatch.index + startMatch[0].length + 1;
            fenceEnd.lastIndex = fencedTextStartIdx;

            const endMatch = fenceEnd.exec(readme);
            if (endMatch === null) {
                break;
            }
            fenceStart.lastIndex = endMatch.index + endMatch[0].length + 1;
            const fencedText = readme.substring(fencedTextStartIdx, endMatch.index);
            // console.log(`${language}: ${fencedText}`);
            checkSample(language, fencedText);
        }
    });

    it('parses the `sample.tree` file', () => {
        const sample = fs.readFileSync('./sample.tree', { encoding: 'utf8' });
        const tree = parse(sample);
        expect(tree.error).to.be.null;
        expect(tree.root).to.be.not.null;
        expect(tree.root.kind).to.be.equal(FALLBACK);
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
            const tree = parse(sampleCode);
            expect(tree.root).to.be.not.null;
            expect(tree.error, `there should be no error in tree sample ${sampleCode}`).to.be.null;
            break;
        case 'javascript':
            const { JSDOM } = require("jsdom");
            // mock the document
            var document = new JSDOM(`<div id="tree-host"/>`).window.document;
            // mock the function, so the sample can run
            var showTree = function (arg1, arg2, arg3, arg4) {
                return () => { };
            }; 
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
            const tree = parse(SAMPLE_TREE);
            expect(tree.root).to.be.not.null;
            expect(tree.error).to.be.null;
            expect(tree.conditions.get('Ghost Scared')).to.have.length(2);
            expect(tree.actions.get('Avoid Ghost')).to.have.length(1);
        });
    });

    context('comments', () => {
        it('ignores full line comment', () => {
            const tree = parse(`;; this is a comment
            ->`);
            expect(tree.error).to.be.null;
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
        });

        it('parses comment', () => {
            const expectedComment = 'this is a comment';
            const [i, comment, err] = parseComment(`;; ${expectedComment}
            ->`, 1);
            expect(err).to.be.null;
            expect(comment).to.be.not.null;
            expect(comment).to.be.equal(expectedComment);
        });

        it('ignores trailing comments', () => {
            const tree = parse(`-> ;; this is a comment`);
            expect(tree.error).to.be.null;
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
        });

        it('enforces double semicolon', () => {
            const tree = parse(`; this is a wrong comment`);
            expect(tree.error).to.be.not.null;
            expect(tree.line).to.be.equal(1);
            expect(tree.error).to.contain(';;'); // should indicate how to write comments
        });
    });

    context('for single-node tree', () => {
        it('parses fallback', () => {
            const tree = parse(`?`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(FALLBACK);
            expect(tree.root.line).to.be.equal(1, 'line number');
        });

        it('parses sequence', () => {
            const tree = parse(`->`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
            expect(tree.root.line).to.be.equal(1, 'line number');
        });

        it('parses parallel', () => {
            const count = 12;
            const tree = parse(`=${count}`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(PARALLEL);
            expect(tree.root.line).to.be.equal(1, 'line number');
            /** @type {Parallel} */
            let actualParallel = tree.root;
            expect(actualParallel.successCount).to.be.equal(count);
        });

        it('parses condition', () => {
            const conditionName = 'condition1';
            const tree = parse(`(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.root.line).to.be.equal(1, 'line number');
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses negated condition', () => {
            const conditionName = 'condition1';
            const tree = parse(`!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(true);
            expect(tree.root.line).to.be.equal(1, 'line number');
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses double-negated condition', () => {
            const conditionName = 'condition1';
            const tree = parse(`!!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.root.line).to.be.equal(1, 'line number');
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses action', () => {
            const actionName = 'action name';
            const tree = parse(`[${actionName}]`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(ACTION);
            expect(tree.root.name).to.be.equal(actionName);
            expect(tree.root.line).to.be.equal(1, 'line number');
            expect(tree.actions.get(actionName)).to.be.deep.equal([tree.root]);
        });
    });

    context('for invalid input', () => {
        it('returns error for empty string', () => {
            const tree = parse('');
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double root', () => {
            const tree = parse(`->
                |   (some condition)
                ->
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double indent (orphan tree branches)', () => {
            const tree = parse(`->
                |   |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("indentation", "there should be error message");
        });

        it('returns error for child of condition', () => {
            const tree = parse(`(condition)
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for child of action', () => {
            const tree = parse(`[action]
                |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for lack of root tree level', () => {
            const tree = parse(`|   [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("no parent", "there should be error message");
        });

        // todo: decide whether the syntax should allow this
        it.skip('returns error for two nodes on the same line', () => {
            const tree = parse(`->  [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });
    });
});

describe("BehaviorTree", () => {
    describe("#fromJson", () => {
        it('builds tree from JSON', () => {
            const tree = BehaviorTree.fromJson(JSON.parse(`{
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
            expect(tree.root.kind).to.be.equal(ACTION);
        });

        it('parses sample and re-hydrates it from JSON', () => {
            const tree = parse(SAMPLE_TREE);
            tree.root.tick();
            const treeAsString = JSON.stringify(tree);
            const treeAsJson = JSON.parse(treeAsString);
            // when
            const actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(JSON.stringify(actualTree)).equal(treeAsString);
        });

        it('re-hydrates true condition from JSON with correct value', () => {
            const conditionName = 'condition1';
            const tree = parse(`(${conditionName})`);
            tree.setConditionStatus(conditionName, SUCCESS);
            tree.root.tick();
            const treeAsString = JSON.stringify(tree);
            const treeAsJson = JSON.parse(treeAsString);
            // when
            const actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(SUCCESS, "condition value should be SUCCESS");
        });

        it('re-hydrates a running action from JSON with correct status', () => {
            const actionName = 'action1';
            const tree = parse(`[${actionName}]`);
            tree.setActionStatus(actionName, RUNNING);
            tree.root.tick();
            const treeAsString = JSON.stringify(tree);
            const treeAsJson = JSON.parse(treeAsString);
            // when
            const actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(RUNNING, "action status should be RUNNING");
            expect(actualTree.root.active()).equal(true, "action status should be 'active'");
        });
    });

    describe('#tick', () => {
        it('notify about action activation when ticked', () => {
            const action1 = action("action1");
            const tree = new BehaviorTree(action1, 0, undefined);
            // when
            /** @type {Action} */
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in parsed tree)', () => {
            const tree = parse(`[a]`);
            expect(tree.root.kind).to.be.equal(ACTION);
            // when
            /** @type {Action} */
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in JSON tree)', () => {
            const tree = BehaviorTree.fromJson(JSON.parse(`{
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
            expect(tree.root.kind).to.be.equal(ACTION);
            // when
            /** @type {Action} */
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        
        it('notify about action activation only once when ticked twice', () => {
            /* tree = [action1] */
            const action1 = action('action1');

            let activationCount = 0;
            action1.onActivation(a => activationCount++);

            //  WHEN
            action1.tick();
            action1.tick();

            // THEN
            expect(activationCount, "activation count").to.equal(1);
        });

        it('notify about action activation only once!', () => {
            /* 
            ?
            |   (condition1)
            |   [action1]
            */
            const condition1 = condition('condition1', false, FAILED);
            const action1 = action('action1');
            const root = fallback([condition1, action1]);
            const tree = new BehaviorTree(root);

            /** @type {Action[]} */
            const actualActivatedActions = [];
            tree.onActionActivation(actionNode => {
                actualActivatedActions.push(actionNode);
                tree.setConditionStatus(condition1.name, SUCCESS)
                tree.tick();
            });
            tree.tick();
            expect(actualActivatedActions).has.lengthOf(1);
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);

            expect(condition1.status()).equal(SUCCESS);
            expect(condition1.active()).equal(true);
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);

            // WHEN
            tree.setConditionStatus(condition1.name, SUCCESS);
            tree.tick();


            // THEN
            expect(tree.root.status()).equal(SUCCESS);
            expect(tree.root.active()).equal(true);
            expect(condition1.status()).equal(SUCCESS);
            expect(condition1.active()).equal(true);
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);
            expect(actualActivatedActions).has.lengthOf(1);
        });
    });

    describe('samples', () => {

        it('executes a sample parsed tree', () => {
            const tree = BehaviorTree.fromText(`
            ?
            |   !(have hunger)
            |   [eat]`);

            // subscribe to action activation
            tree.onActionActivation(actionNode => {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', SUCCESS);
                        }
                }
            });
            tree.root.tick();

            console.log('Initial state:');
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true

            // then we get hunger
            tree.setConditionStatus('have hunger', SUCCESS);
            const statusAfterHungerIsTrue = tree.root.tick();
            console.log(getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
        });

        it('executes a sample coded tree', () => {

            // define the action 'eat' implementation
            const onEat = function (actionNode) {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', SUCCESS);
                        }
                }
            };

            // ?
            // |   !(have hunger)
            // |   [eat]`

            const rootNode = fallback([
                condition("have hunger", true),
                action("eat", onEat)
            ]);
            const tree = new BehaviorTree(rootNode);

            tree.root.tick();

            console.log('Initial state:');
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true

            // then we get hunger
            tree.setConditionStatus('have hunger', SUCCESS);
            const statusAfterHungerIsTrue = tree.root.tick();
            console.log(getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
        });

    });
});

describe('#fallback', () => {
    it('resolves to FAILED when no children', () => {
        const tree = parse(`?`);
        expect(tree.root).to.be.not.null;
        expect(tree.root.kind).to.be.equal(FALLBACK);
        // when
        tree.root.tick();
        expect(tree.root.status()).equal(FAILED);
    });
});

describe('Action', () => {
    describe('#tick', () => {
        it('runs action when ticked', () => {
            /** @type {Action} */
            let actualActivatedAction = null;
            const action1 = action("action1", actionNode => actualActivatedAction = actionNode);
            // when
            action1.tick();
            // then
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedAction).deep.equal(action1);
        });
    });

    describe('#wasActive', () => {
        it('re-activates previously active action', () => {
            const action1 = action("action1", actionNode => actualActivatedActions.push(actionNode));
            // when
            const actualActivatedActions = [];
            action1.tick();
            // then
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedActions).contains(action1);
            // when .. action is finished
            action1.setStatus(SUCCESS);
            action1.deactivate(); // simulate that another tree branch became active
            // then
            expect(action1.status()).equal(SUCCESS);
            expect(action1.active()).equal(false);
            expect(action1.wasActive).equal(true);
        });
    });
});
