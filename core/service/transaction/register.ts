import { IAssetService } from 'core/service/transaction';
import { IAssetRegister, Transaction, TransactionModel } from 'shared/model/transaction';
import { Account } from 'shared/model/account';
import { ResponseEntity } from 'shared/model/response';
import AccountRepo from 'core/repository/account';
import { referredUsersFactory, FactorAction } from 'core/repository/referredUsers';
import config from 'shared/config';
import BUFFER from 'core/util/buffer';
import { isARPEnabled } from 'core/util/feature';
import account from 'api/controller/account';
import { isAccountReferrer } from 'core/util/referral';

class TransactionRegisterService implements IAssetService<IAssetRegister> {

    create(trs: TransactionModel<IAssetRegister>): IAssetRegister {
        return {
            referral: BigInt(trs.asset.referral),
        };
    }

    getBytes(trs: Transaction<IAssetRegister>): Buffer {
        const buff = Buffer.alloc(BUFFER.LENGTH.INT64);
        BUFFER.writeUInt64LE(buff, trs.asset.referral, 0);
        return buff;
    }

    validate(trs: Transaction<IAssetRegister>): ResponseEntity<void> {
        const errors = [];

        if (!trs.asset.referral) {
            errors.push('Missing referral');
        }

        return new ResponseEntity<void>({ errors });
    }

    // TODO check empty account
    verifyUnconfirmed(trs: Transaction<IAssetRegister>, sender: Account): ResponseEntity<void> {
        const errors = [];

        if (
            sender.secondPublicKey ||
            sender.actualBalance !== 0 ||
            sender.delegate ||
            (sender.votes && sender.votes.length) ||
            (sender.referrals && sender.referrals.length) ||
            (sender.stakes && sender.stakes.length)
        ) {
            return new ResponseEntity<void>({ errors: ['Account already exists.'] });
        }

        const referrer: Account = AccountRepo.getByAddress(trs.asset.referral);
        if (isARPEnabled() && !isAccountReferrer(referrer)) {
            return new ResponseEntity<void>({ errors: ['Referral link is invalid.'] });
        }

        return new ResponseEntity<void>({ errors });
    }

    calculateFee(trs: Transaction<IAssetRegister>, sender: Account): number {
        return 0;
    }

    applyUnconfirmed(trs: Transaction<IAssetRegister>, sender: Account): void {
        let referralAccount: Account = AccountRepo.getByAddress(trs.asset.referral);

        if (!referralAccount) {
            referralAccount = AccountRepo.add({
                address: trs.asset.referral
            });

            referredUsersFactory.get().add(referralAccount);
        }

        const targetAccount: Account = AccountRepo.add({
            address: trs.senderAddress,
            publicKey: trs.senderPublicKey
        });

        this.addReferral(referralAccount, targetAccount);

        referredUsersFactory.get().add(targetAccount);
        referredUsersFactory.get().updateCountFactor(trs, FactorAction.ADD);
    }

    undoUnconfirmed(trs: Transaction<IAssetRegister>, sender: Account, senderOnly: boolean): void {
        referredUsersFactory.get().updateCountFactor(trs, FactorAction.SUBTRACT);
        sender.referrals = [];
    }

    private addReferral(referralAccount: Account, targetAccount: Account) {
        let referrals: Array<Account>;

        if (isARPEnabled()) {
            referrals = referralAccount.arp.referrals
                .slice(0, config.CONSTANTS.REFERRAL.MAX_COUNT - 1)
                .map(referral => new Account(referral));
            targetAccount.arp.referrals = [referralAccount, ...referrals];
            return;
        }

        referrals = referralAccount.referrals.slice(0, config.CONSTANTS.REFERRAL.MAX_COUNT - 1);
        targetAccount.referrals = [referralAccount, ...referrals];
    }
}

export default new TransactionRegisterService();
