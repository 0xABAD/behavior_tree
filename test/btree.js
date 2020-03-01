//@ts-check

let btree = require('../btree').bt;
let expect = require('chai').expect;

describe('#parse', () => {

    context('valid input', () => {
        it('parses sample', () => {
            let tree = btree.parse(btree.SAMPLE_TREE);
            expect(tree.root).to.be.not.null;
            expect(tree.error).to.be.null;
            expect(tree.conditions['Ghost Scared']).to.have.length(2);
            expect(tree.actions['Avoid Ghost']).to.have.length(1);
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
            expect(tree.root.successCount).to.be.equal(count);
        });

        it('parses condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions[conditionName]).to.be.deep.equal([tree.root]);
        });

        it('parses negated condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(true);
            expect(tree.conditions[conditionName]).to.be.deep.equal([tree.root]);
        });

        it('parses double-negated condition', () => {
            let conditionName = 'condition1';
            let tree = btree.parse(`!!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions[conditionName]).to.be.deep.equal([tree.root]);
        });

        it('parses action', () => {
            let actionName = 'action name';
            let tree = btree.parse(`[${actionName}]`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(btree.ACTION);
            expect(tree.root.name).to.be.equal(actionName);
            expect(tree.actions[actionName]).to.be.deep.equal([tree.root]);
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
            expect(actualTree.root.active).equal(true, "action status should be 'active'");
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

describe('#action', () => {
    it('runs action when ticked', () => {
        let tree = btree.parse(`[a]`);
        expect(tree.root.kind).to.be.equal(btree.ACTION);
        // when
        let activatedAction = null;
        tree.onActionActivation(actionNode => activatedAction = actionNode);
        tree.root.tick();
        expect(tree.root.status()).equal(btree.RUNNING);
        expect(tree.root.active).equal(true);
        expect(activatedAction).equal(tree.root);
    });
});
