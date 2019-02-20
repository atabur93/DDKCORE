import ResponseEntity from 'shared/model/response';
import { Account } from 'shared/model/account';
import crypto from 'crypto';
import SlotService from 'core/service/slot';
import Config from 'shared/util/config';
// todo delete it when find a way to mock services for tests
// import BlockService from 'test/core/mock/blockService';
// import { createTaskON } from 'test/core/mock/bus';
// import BlockRepository from 'test/core/mock/blockRepository';
import BlockService from 'core/service/block';
import BlockRepository from 'core/repository/block';
import { Slots } from 'shared/model/round';
import RoundRepository from 'core/repository/round';
import { createTaskON } from 'shared/util/bus';
import mockDelegate from 'test/core/mock/delegate';
const constants = Config.constants;

interface IHashList {
    hash: string;
    generatorPublicKey: string;
}

interface IRoundSum {
    roundFees: number;
    roundDelegates: Array<string>;
}

interface IRoundService {
    /**
     * Get active delegates
     * @implements {getDelegates(vote, activeDelegates): Array<Delegate>} DelegateRepository
     * @param limit: activeDelegateCount
     */
    getActiveDelegates(): ResponseEntity<any>;

    /**
     * Generate hash (delegate publicKey + previousBlockId)
     * @return hash from DelegatePublicKey + blockId
     */
    generateHashList(params: {activeDelegates: Array<Account>, blockId: string}):
        Array<{hash: string, generatorPublicKey: string}>;

    sortHashList(hashList: Array<{hash: string, generatorPublicKey: string}>):
        Array<{hash: string, generatorPublicKey: string}>;

    /**
     * Match hash to delegates
     * Create  and store to this.round
     */
    generatorPublicKeyToSlot(sortedHashList: Array<{hash: string, generatorPublicKey: string}>): Slots;

    /**
     * triggered by onRoundFinish or onApplyLastBlockInRound
     * @implements getLastBlock from blocks repository
     */
    generateRound(): ResponseEntity<void>;

    /**
     * @implements publicKey from config
     * @return your slot for rxBus
     */
    getMyTurn(): number;

    /**
     * calculateReward
     */
    sumRound(round): Promise<IRoundSum>;

    /**
     * Rebuild round if one of blocks apply with delay
     */
    rebuildRound(): void;

    /**
     * Rollback round if one of blocks fails
     */
    rollBackRound(): void;

    validateRound(): boolean;

    applyRound(param: IRoundSum): boolean;

    /**
     * Calculates round number from the given height.
     * @param {number} height - Height from which round is calculated
     * @returns {number} Round number
     */
    calcRound(height: number): number;

}

class RoundService implements IRoundService {
    // todo mock delegates from genesis and change
    public getActiveDelegates(): ResponseEntity<any> {
        return new ResponseEntity({
            data: mockDelegate.getDelegates()
        });
    }

    private compose(...fns): any {
        return fns.reduceRight((prevFn, nextFn) =>
                (...args) => nextFn(prevFn(...args)),
            value => value
        );
    }

    public generateHashList(params: {activeDelegates: Array<Account>, blockId: string}):
    Array<IHashList> {
        return params.activeDelegates.map((delegate) => {
            const publicKey = delegate.publicKey;
            const hash = crypto.createHash('md5').update(publicKey + params.blockId).digest('hex');
            return {
                hash,
                generatorPublicKey: publicKey
            };
        });
    }

    public sortHashList(hashList: Array<IHashList>):
    Array<IHashList> {
        return hashList.sort((a, b) => {
            if (a.hash > b.hash) {
                return 1;
            }
            if (a.hash < b.hash) {
                return -1;
            }
            return 0;
        });
    }

    public generatorPublicKeyToSlot(sortedHashList: Array<IHashList>): Slots {
        let firstSlot = SlotService.getSlotNumber();
        // set the last round slot

        return sortedHashList.reduce(
            (acc: Object = {}, item: IHashList, i) => {
            acc[item.generatorPublicKey] = { slot: firstSlot + i };
            return acc;
        }, {});
    }

    public generateRound(): ResponseEntity<void> {
        /**
         * if triggered by ROUND_FINISH event
         */
        if (
            RoundRepository.getCurrentRound()
        ) {
            // calculate rewards and apply
            this.compose(
                this.applyRound,
                this.sumRound
            )(RoundRepository.getCurrentRound());

            // store pound as previous
            RoundRepository.setPrevRound(RoundRepository.getCurrentRound());
        }

        const lastBlock = BlockService.getLastBlock();
        const { data } = this.getActiveDelegates(); // todo wait for implementation method

        const slots = this.compose(
            this.generatorPublicKeyToSlot,
            this.sortHashList,
            this.generateHashList
        )
        ({blockId: lastBlock.id, activeDelegates: data});

        RoundRepository.setCurrentRound({slots, startHeight: lastBlock.height + 1});

        const mySlot = this.getMyTurn();

        if (mySlot) {
            // start forging block at mySlotTime
            createTaskON('BLOCK_GENERATE', SlotService.getSlotTime(mySlot));
        }

        // create event for end of current round
        createTaskON('ROUND_FINISH', SlotService.getSlotTime(RoundRepository.getLastSlotInRound()));

        return new ResponseEntity();
    }

    public getMyTurn(): number {
        return RoundRepository.getCurrentRound().slots[constants.publicKey].slot;
    }

    public async sumRound(round): Promise<IRoundSum> {
        const { data } = await BlockRepository.loadBlocksOffset(
            {
                offset: round.startHeight,
                limit: constants.activeDelegates
            });

        const resp: IRoundSum = {
            roundFees: 0,
            roundDelegates: []
        };
        for (let i = 0; i < data.length; i++) {
            resp.roundFees += data[i].fee;
            resp.roundDelegates.push(data[i].generatorPublicKey);
        }

        return resp;
    }

    public rebuildRound(): void {
    }

    public rollBackRound(): void {
    }

    public validateRound(): boolean {
        return undefined;
    }

    public applyRound(param: IRoundSum): boolean {
        if (!param.roundDelegates.length) {
            return false;
        }

        // increase delegates balance
        // get delegates by publicKey
            // balance = balance + totalRoundFee/count(delegates)
            // update delegate
        return undefined;
    }

    public calcRound(height: number): number {
        return Math.ceil(height / constants.activeDelegates); // todo round has diff amount of blocks
    }
}

export default new RoundService();