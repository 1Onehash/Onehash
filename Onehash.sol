// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract OneHash is ERC20, Ownable {

    uint256 constant TOKEN_RESERVE_FOR_AIRDROP   = 10000000;
    uint256 constant TOKEN_RESERVE_FOR_LIQUIDITY = 10000000;
    uint256 constant TOKEN_RESERVE_FOR_DEVELOPER = 1000000;
    uint256 constant INSCRIBING_FEE = 0.005 ether;

    bool public ethSent;
    bool public airdropMinted;
    bool public liquidityMinted;
    bool public developerMinted;

    event Data(address indexed account, bytes data);

    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {}

    receive() external payable {}

    fallback() external payable {
        require(msg.sender == tx.origin);
        require(msg.value == INSCRIBING_FEE);
        emit Data(msg.sender, msg.data);
    }

    function sendETH(address[] calldata accounts, uint256[] calldata values) external onlyOwner {
        require(!ethSent);
        require(accounts.length == values.length);
        for (uint i; i < accounts.length; i++) {
            payable(accounts[i]).transfer(values[i]);
        }
        ethSent = true;
    }

    function mintAirdrop(address[] calldata accounts, uint256[] calldata values) external onlyOwner {
        require(!airdropMinted);
        require(accounts.length == values.length);
        uint256 tokenMinted = 0;
        for (uint i; i < accounts.length; i++) {
            tokenMinted += values[i];
            _mint(accounts[i], values[i]);
        }
        require(tokenMinted == TOKEN_RESERVE_FOR_AIRDROP);
        airdropMinted = true;
    }

    function mintLiquidity() external onlyOwner {
        require(!liquidityMinted);
        _mint(owner(), TOKEN_RESERVE_FOR_LIQUIDITY);
        liquidityMinted = true;
    }

    function mintDeveloper(address account) external onlyOwner {
        require(!developerMinted);
        _mint(account, TOKEN_RESERVE_FOR_DEVELOPER);
        developerMinted = true;
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
