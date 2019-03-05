import { IAssetTransfer, Transaction, TransactionStatus, TransactionType } from 'shared/model/transaction';
import { transactionSortFunc } from 'core/util/transaction';
import TransactionDispatcher from 'core/service/transaction';
import Response from 'shared/model/response';
import ResponseEntity from 'shared/model/response';
import { logger } from 'shared/util/logger';
import SyncService from 'core/service/sync';
import { Account, Address } from 'shared/model/account';
import AccountRepository from 'core/repository/account';

export interface ITransactionPoolService<T extends Object> {
    /**
     * old removeFromPool
     */
    batchRemove(transactions: Array<Transaction<T>>, withDepend: boolean): Response<Array<Transaction<T>>>;

    /**
     *
     * old pushInPool
     */
    batchPush(transactions: Array<Transaction<T>>): void;

    getLockStatus(): boolean;

    getBySenderAddress(senderAddress: Address): Array<Transaction<T>>;
    getByRecipientAddress(recipientAddress: Address): Array<Transaction<T>>;

    removeBySenderAddress(senderAddress: Address): Array<Transaction<T>>;
    removeByRecipientAddress(address: Address): Array<Transaction<T>>;

    push(trs: Transaction<T>, sender?: Account, broadcast?: boolean, force?: boolean): Response<void>;

    remove(trs: Transaction<T>);

    get(id: string): Transaction<T>;

    pop(trs: Transaction<T>): Transaction<T>;

    has(trs: Transaction<T>);

    popSortedUnconfirmedTransactions(limit: number): Array<Transaction<T>>;

    isPotentialConflict(trs: Transaction<T>);

    getSize(): number;

    lock(): void;

    unlock(): void;
}

class TransactionPoolService<T extends object> implements ITransactionPoolService<T> {
    private pool: { [transactionId: string]: Transaction<T> } = {};

    poolByRecipient: { [recipientAddress: number]: Array<Transaction<T>> } = {};
    poolBySender: { [senderAddress: number]: Array<Transaction<T>> } = {};

    locked: boolean = false;

    batchPush(transactions: Array<Transaction<T>>): Promise<void> {
        return undefined;
    }

    batchRemove(
        transactions: Array<Transaction<T>>,
        withDepend: boolean,
    ): Response<Array<Transaction<T>>> {
        const removedTransactions = [];
        for (const trs of transactions) {
            if (withDepend) {
                removedTransactions.push(...this.removeBySenderAddress(trs.senderAddress));
                removedTransactions.push(...this.removeByRecipientAddress(trs.senderAddress));
            } else {
                const removed = this.remove(trs);
                if (removed) {
                    removedTransactions.push(trs);
                }
            }
        }

        return new ResponseEntity<Array<Transaction<T>>>({ data: removedTransactions });
    }

    lock(): Response<void> {
        this.locked = true;
        return new Response<void>();
    }

    unlock(): Response<void> {
        this.locked = false;
        return new Response<void>();
    }

    getLockStatus(): boolean {
        return this.locked;
    }

    getByRecipientAddress(recipientAddress: Address): Array<Transaction<T>> {
        return this.poolByRecipient[recipientAddress] || [];
    }

    getBySenderAddress(senderAddress: Address): Array<Transaction<T>> {
        return this.poolBySender[senderAddress] || [];
    }

    removeBySenderAddress(senderAddress: Address): Array<Transaction<T>> {
        const removedTransactions = [];
        const transactions = this.getBySenderAddress(senderAddress);
        for (const trs of transactions) {
            this.remove(trs);
            removedTransactions.push(trs);
        }
        return removedTransactions;
    }

    push(
        trs: Transaction<T>,
        sender: Account,
        broadcast: boolean = false,
        force: boolean = false,
    ): Response<void> {
        if ((this.locked && !force)) {
            return new Response<void>({ errors: [`Cannot push this transaction`] });
        }

        if (this.has(trs)) {
            return new Response<void>({ errors: [`Transaction is already in pool`] });
        }

        if (!force && this.isPotentialConflict(trs)) {
            return new Response<void>({ errors: [`Transaction is potential conflicted`] });
        }

        this.pool[trs.id] = trs;
        trs.status = TransactionStatus.PUT_IN_POOL;

        if (!this.poolBySender[trs.senderAddress]) {
            this.poolBySender[trs.senderAddress] = [];
        }
        this.poolBySender[trs.senderAddress].push(trs);
        if (trs.type === TransactionType.SEND) {
            const asset: IAssetTransfer = <IAssetTransfer>trs.asset;
            if (!this.poolByRecipient[asset.recipientAddress]) {
                this.poolByRecipient[asset.recipientAddress] = [];
            }
            this.poolByRecipient[asset.recipientAddress].push(trs);
        }

        if (!sender) {
            sender = AccountRepository.getByPublicKey(trs.senderPublicKey);
        }

        try {
            TransactionDispatcher.applyUnconfirmed(trs, sender);
            trs.status = TransactionStatus.UNCONFIRM_APPLIED;
        } catch (e) {
            delete this.pool[trs.id];
            trs.status = TransactionStatus.DECLINED;
            logger.error(`[TransactionPool][applyUnconfirmed]: ${e}`);
            logger.error(`[TransactionPool][applyUnconfirmed][stack]: \n ${e.stack}`);
            return new Response<void>({ errors: [`Cannot apply unconfirmed this transaction`] });
        }

        if (broadcast) {
            // TODO: fix broadcast storm
            SyncService.sendUnconfirmedTransaction(trs);
        }

        return new Response<void>();
    }

    remove(trs: Transaction<T>) {
        if (!this.pool[trs.id]) {
            return false;
        }

        try {
            TransactionDispatcher.undoUnconfirmed(trs);
        } catch (e) {
            logger.error(`[TransactionPool][remove]: ${e}`);
            logger.debug(`[TransactionPool][remove][stack]: \n ${e.stack}`);
        }

        delete this.pool[trs.id];

        if (this.poolBySender[trs.senderAddress] && this.poolBySender[trs.senderAddress].indexOf(trs) !== -1) {
            this.poolBySender[trs.senderAddress].splice(this.poolBySender[trs.senderAddress].indexOf(trs), 1);
        }

        if (trs.type === TransactionType.SEND) {
            const asset: IAssetTransfer = <IAssetTransfer>trs.asset;
            if (this.poolByRecipient[asset.recipientAddress] &&
                this.poolByRecipient[asset.recipientAddress].indexOf(trs) !== -1
            ) {
                this.poolByRecipient[asset.recipientAddress]
                    .splice(this.poolByRecipient[asset.recipientAddress].indexOf(trs), 1);
            }
        }
        return true;
    }

    removeByRecipientAddress(address: Address): Array<Transaction<T>> {
        const removedTransactions = [];
        const transactions = this.getByRecipientAddress(address);
        for (const trs of transactions) {
            this.remove(trs);
            removedTransactions.push(trs);
        }
        return removedTransactions;
    }

    get(id: string): Transaction<T> {
        return this.pool[id];
    }

    pop(trs: Transaction<T>): Transaction<T> {
        const deletedValue = this.get(trs.id);
        this.remove(trs);
        return deletedValue;
    }

    has(trs: Transaction<T>) {
        return Boolean(this.pool[trs.id]);
    }

    popSortedUnconfirmedTransactions(limit: number): Array<Transaction<T>> {
        const transactions = Object.values(this.pool).sort(transactionSortFunc).slice(0, limit);
        for (const trs of transactions) {
            this.remove(trs);
        }

        return transactions;
    }

    isPotentialConflict(trs: Transaction<T>): boolean {
        const { senderAddress } = trs;
        const recipientTrs = this.poolByRecipient[senderAddress] || [];
        const senderTrs = this.poolBySender[senderAddress] || [];
        const dependTransactions = [...recipientTrs, ...senderTrs];

        if (dependTransactions.length === 0) {
            return false;
        }

        if (trs.type === TransactionType.SIGNATURE) {
            return true;
        }

        if (
            (
                trs.type === TransactionType.VOTE ||
                trs.type === TransactionType.SEND ||
                trs.type === TransactionType.STAKE
            ) && dependTransactions.find((t: Transaction<T>) => t.type === TransactionType.VOTE)
        ) {
            return true;
        }

        if (
            trs.type === TransactionType.REGISTER &&
            dependTransactions.find((t: Transaction<T>) => t.type === TransactionType.REGISTER)
        ) {
            return true;
        }

        dependTransactions.push(trs);
        dependTransactions.sort(transactionSortFunc);
        return dependTransactions.indexOf(trs) !== (dependTransactions.length - 1);
    }

    getSize(): number {
        return Object.keys(this.pool).length;
    }
}

export default new TransactionPoolService();
