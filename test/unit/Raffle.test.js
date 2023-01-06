const { assert, expect } = require("chai")
const { network, ethers, deployments } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name) &&
    describe("Raffle Unit Tests", () => {
        let raffle, raffleContract, vrfCoordinatiorV2Mock, raffleEntranceFee, interval, player
        beforeEach(async () => {
            await network.provider.send("hardhat_reset")
            accounts = await ethers.getSigners() // could also do with getNamedAccounts
            //   deployer = accounts[0]
            player = accounts[1]
            await deployments.fixture(["mocks", "raffle"]) // Deploys modules with the tags "mocks" and "raffle"
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock") // Returns a new connection to the VRFCoordinatorV2Mock contract
            raffleContract = await ethers.getContract("Raffle") // Returns a new connection to the Raffle contract
            raffle = raffleContract.connect(player) // Returns a new instance of the Raffle contract connected to player
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("constructor", () => {
            it("initializes the raffle correctly", async () => {
                // Ideally, we'd separate these out so that only 1 assert per "it" block
                // And ideally, we'd make this check everything
                const raffleState = (await raffle.getRaffleState()).toString()
                // Comparison for Raffle initalization:
                assert.equal(raffleState, "0")
                assert.equal(
                    interval.toString(),
                    networkConfig[network.config.chainId]["keepersUpdateInterval"]
                )
            })
        })

        describe("enterRaffle", () => {
            it("reverts when you don't pay enough", async () => {
                await expect(raffle.enterRaffle()).to.be.revertedWith(
                    // is reverted when not paid enough or raffle is not open
                    "Raffle__NotEnoughETHEntered"
                )
            })
            it("records player when they enter", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                const contractPlayer = await raffle.getPlayer(0)
                assert.equal(player.address, contractPlayer)
            })
            it("emits event on enter", async () => {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                    // emits RaffleEnter event if entered to index palyers address
                    raffle,
                    "RaffleEnter"
                )
            })
            it("doesn't allow entrace when raffle is calculating", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                // we pretend to be a keeper for a second
                await raffle.performUpkeep([]) // raffle state change to calculating
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                    "Raffle__RaffleNotOpen"
                )
            })
            describe("checkUpkeep", () => {
                it("returns false if people haven't sent any ETH", async () => {
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                    // callstatic is asking the node to simulate the call but not to make the transaction
                    assert(!upkeepNeeded)
                })
                it("returns true if enough time has passed, has player, eth, and is opend", async () => {
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                    assert(upkeepNeeded)
                })
            })

            describe("performUpkeep", () => {
                it("can only urn if checkupkeep is true", async () => {
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const tx = await raffle.performUpkeep("0x")
                    assert(tx)
                })
                it("reverts if checkup is false", async () => {
                    await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                        "Raffle__UpkeepNotNeeded"
                    )
                })
                it("updates the raffle state and emits a requestId", async () => {
                    // Too many asserts in this test!
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const txResponse = await raffle.performUpkeep("0x") // emits requestId
                    const txReceipt = await txResponse.wait(1) // waits 1 block
                    const raffleState = await raffle.getRaffleState() // updates state
                    const requestId = txReceipt.events[1].args.requestId
                    assert(requestId.toNumber() > 0)
                    assert(raffleState == 1) // 0 = open, 1 = calculating
                })
            })

            describe("fulfillRandomWords", function () {
                beforeEach(async () => {
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                })
                it("can only be called after performupkeep", async () => {
                    await expect(
                        vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                    ).to.be.revertedWith("nonexistent request")
                    await expect(
                        vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                    ).to.be.revertedWith("nonexistent request")
                })

                // This test is too big...
                // This test simulates users entering the raffle and wraps the entire functionality of the raffle
                // inside a promise that will resolve if everything is successful.
                // An event listener for the WinnerPicked is set up
                // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
                // All the assertions are done once the WinnerPicked event is fired
                it("picks a winner, resets, and sends money", async () => {
                    const additionalEntrances = 3 // to test
                    const startingIndex = 2
                    for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                        raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                        await raffle.enterRaffle({ value: raffleEntranceFee })
                    }
                    const startingTimeStamp = await raffle.getLastTimeStamp() // stores starting timestamp (before we fire our event)

                    // This will be more important for our staging tests...
                    await new Promise(async (resolve, reject) => {
                        raffle.once("WinnerPicked", async () => {
                            // event listener for WinnerPicked
                            console.log("WinnerPicked event fired!")
                            // assert throws an error if it fails, so we need to wrap
                            // it in a try/catch so that the promise returns event
                            // if it fails.
                            try {
                                // Now lets get the ending values...
                                const recentWinner = await raffle.getRecentWinner()
                                const raffleState = await raffle.getRaffleState()
                                const winnerBalance = await accounts[2].getBalance()
                                const endingTimeStamp = await raffle.getLastTimeStamp()
                                await expect(raffle.getPlayer(0)).to.be.reverted
                                // Comparisons to check if our ending values are correct:
                                assert.equal(recentWinner.toString(), accounts[2].address)
                                assert.equal(raffleState, 0)
                                assert.equal(
                                    winnerBalance.toString(),
                                    startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                        .add(
                                            raffleEntranceFee
                                                .mul(additionalEntrances)
                                                .add(raffleEntranceFee)
                                        )
                                        .toString()
                                )
                                assert(endingTimeStamp > startingTimeStamp)
                                resolve() // if try passes, resolves the promise
                            } catch (e) {
                                reject(e) // if try fails, rejects the promise
                            }
                        })

                        // kicking off the event by mocking the chainlink keepers and vrf coordinator
                        const tx = await raffle.performUpkeep("0x")
                        const txReceipt = await tx.wait(1)
                        const startingBalance = await accounts[2].getBalance()
                        await vrfCoordinatorV2Mock.fulfillRandomWords(
                            txReceipt.events[1].args.requestId,
                            raffle.address
                        )
                    })
                })
            })
        })
    })
