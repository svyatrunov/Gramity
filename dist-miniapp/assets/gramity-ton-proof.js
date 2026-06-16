(function (global) {
  function extractProofItem(wallet) {
    if (!wallet || !wallet.connectItems || !wallet.connectItems.tonProof) return null;
    var item = wallet.connectItems.tonProof;
    if (item.name !== 'ton_proof') return null;
    return item;
  }

  function GramityTonProof(tonConnectUI, apiPost) {
    this.ui = tonConnectUI;
    this.apiPost = apiPost;
    this.verifiedAddress = null;
    this._verifying = false;
    this._onVerified = null;
    this._onFailed = null;

    var self = this;
    tonConnectUI.onStatusChange(function (wallet) {
      self._handleStatus(wallet);
    });
  }

  GramityTonProof.prototype.onVerified = function (fn) {
    this._onVerified = fn;
  };

  GramityTonProof.prototype.onFailed = function (fn) {
    this._onFailed = fn;
  };

  GramityTonProof.prototype.openWithProof = function () {
    var self = this;
    var ui = this.ui;
    ui.setConnectRequestParameters({ state: 'loading' });
    return this.apiPost('/auth/ton-proof/payload', {})
      .then(function (data) {
        ui.setConnectRequestParameters({
          state: 'ready',
          value: { tonProof: data.payload },
        });
        ui.openModal();
      })
      .catch(function (err) {
        ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: '' } });
        throw err;
      });
  };

  GramityTonProof.prototype._handleStatus = function (wallet) {
    if (!wallet || !wallet.account || !wallet.account.address) {
      this.verifiedAddress = null;
      return;
    }

    var proofItem = extractProofItem(wallet);
    if (!proofItem) return;

    if (proofItem.error) {
      this.verifiedAddress = null;
      if (this._onFailed) this._onFailed(new Error(proofItem.error.message || 'Proof rejected'));
      return;
    }

    if (!proofItem.proof || this._verifying) return;

    var self = this;
    this._verifying = true;
    this.verifyWallet(wallet, proofItem)
      .then(function (result) {
        self.verifiedAddress = result.address;
        if (self._onVerified) self._onVerified(result.address, wallet);
      })
      .catch(function (err) {
        self.verifiedAddress = null;
        if (self._onFailed) self._onFailed(err);
        self.ui.disconnect().catch(function () {});
      })
      .finally(function () {
        self._verifying = false;
      });
  };

  GramityTonProof.prototype.verifyWallet = function (wallet, proofItem) {
    var proof = proofItem.proof;
    return this.apiPost('/auth/ton-proof/verify', {
      address: wallet.account.address,
      public_key: wallet.account.publicKey,
      network: wallet.account.chain,
      proof: {
        timestamp: proof.timestamp,
        domain: proof.domain,
        signature: proof.signature,
        payload: proof.payload,
        state_init: wallet.account.walletStateInit,
      },
    });
  };

  GramityTonProof.prototype.isVerified = function (address) {
    if (!this.verifiedAddress || !address) return false;
    return this.verifiedAddress === address;
  };

  global.GramityTonProof = GramityTonProof;
})(window);
