use near_sdk::{
    env, near, require,
    store::{LookupMap, Vector},
    AccountId, NearToken,
};

const JOIN_DEPOSIT: NearToken = NearToken::from_millinear(10);

#[near(contract_state)]
pub struct Waitlist {
    accounts: Vector<AccountId>,
    positions: LookupMap<AccountId, u32>,
}

impl Default for Waitlist {
    fn default() -> Self {
        Self {
            accounts: Vector::new(b"a"),
            positions: LookupMap::new(b"p"),
        }
    }
}

#[near]
impl Waitlist {
    #[payable]
    pub fn join(&mut self) -> u32 {
        let account = env::signer_account_id();
        require!(
            env::predecessor_account_id() == account,
            "Sign directly from your wallet"
        );
        require!(
            env::attached_deposit() == JOIN_DEPOSIT,
            "Attach 0.01 NEAR for storage"
        );
        require!(
            !self.positions.contains_key(&account),
            "Wallet already joined"
        );

        self.accounts.push(account.clone());
        let position = self.accounts.len();
        self.positions.insert(account, position);
        position
    }

    pub fn position(&self, account_id: AccountId) -> Option<u32> {
        self.positions.get(&account_id).copied()
    }

    pub fn count(&self) -> u32 {
        self.accounts.len()
    }

    pub fn entries(&self, from: u32, limit: u32) -> Vec<AccountId> {
        let end = from.saturating_add(limit.min(50)).min(self.accounts.len());
        (from..end)
            .filter_map(|index| self.accounts.get(index).cloned())
            .collect()
    }
}
