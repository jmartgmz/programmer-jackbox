from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from bugFixerCardHandling import (
	PromptCard,
	SolutionCard,
	choose_prompt,
	draw_unique_hand,
	load_prompt_cards,
	load_solution_cards,
)


@dataclass
class Submission:
	player_name: str
	chosen_cards: List[SolutionCard]

	def render(self) -> str:
		return " | ".join(card.response for card in self.chosen_cards)


def _ask_int(prompt: str, minimum: int, maximum: int | None = None) -> int:
	while True:
		raw = input(prompt).strip()
		try:
			value = int(raw)
		except ValueError:
			print("Please enter a valid number.")
			continue

		if value < minimum:
			print(f"Please enter a number >= {minimum}.")
			continue

		if maximum is not None and value > maximum:
			print(f"Please enter a number <= {maximum}.")
			continue

		return value


def _collect_players() -> List[str]:
	print("Enter player names in lobby order. Type a blank line to finish.")
	players: List[str] = []
	while True:
		name = input(f"Player {len(players) + 1}: ").strip()
		if not name:
			break

		if name in players:
			print("Duplicate name. Please enter a unique player name.")
			continue

		players.append(name)

	if len(players) < 3:
		raise ValueError("Bug Fixer requires at least 3 players")

	return players


def _select_cards(player_name: str, hand: List[SolutionCard], picks_required: int) -> List[SolutionCard]:
	if picks_required > len(hand):
		raise ValueError("Prompt requires more picks than the hand size")

	print(f"\n{player_name}, choose {picks_required} card(s):")
	for index, card in enumerate(hand, start=1):
		print(f"  {index}. {card.response}")

	chosen_indices: List[int] = []
	while len(chosen_indices) < picks_required:
		remaining = picks_required - len(chosen_indices)
		pick = _ask_int(f"Select card number ({remaining} pick(s) left): ", 1, len(hand)) - 1

		if pick in chosen_indices:
			print("You already picked that card. Choose a different one.")
			continue

		chosen_indices.append(pick)

	return [hand[idx] for idx in chosen_indices]


def _print_scoreboard(scores: Dict[str, int]) -> None:
	print("\nCurrent Scoreboard")
	print("------------------")
	ranked = sorted(scores.items(), key=lambda entry: (-entry[1], entry[0].lower()))
	for player, points in ranked:
		print(f"{player}: {points}")


def run_bug_fixer_game(players: List[str], rounds_per_decider: int = 1) -> Dict[str, int]:
	prompt_cards = load_prompt_cards()
	solution_cards = load_solution_cards()

	used_prompt_indices: set[int] = set()
	scores: Dict[str, int] = {player: 0 for player in players}

	round_number = 1
	for cycle in range(rounds_per_decider):
		print(f"\n=== Decider Cycle {cycle + 1}/{rounds_per_decider} ===")
		for decider in players:
			_, prompt = choose_prompt(prompt_cards, used_prompt_indices)
			print(f"\n--- Round {round_number}: Decider is {decider} ---")
			print(f"Prompt: {prompt.prompt}")

			submissions: List[Submission] = []
			for player in players:
				if player == decider:
					continue

				hand = draw_unique_hand(solution_cards, hand_size=5)
				chosen = _select_cards(player, hand, prompt.responses)
				submissions.append(Submission(player_name=player, chosen_cards=chosen))

			if not submissions:
				raise RuntimeError("No submissions received for round")

			print("\nSubmissions")
			print("-----------")
			for index, submission in enumerate(submissions, start=1):
				print(f"{index}. {submission.render()}")

			winner_index = _ask_int(
				f"\n{decider}, choose the winning submission: ",
				1,
				len(submissions),
			)
			winner = submissions[winner_index - 1].player_name
			scores[winner] += 1

			print(f"{decider} picked {winner}. +1 point to {winner}.")
			_print_scoreboard(scores)
			round_number += 1

	print("\n=== Final Scoreboard ===")
	_print_scoreboard(scores)
	top_score = max(scores.values())
	winners = [player for player, points in scores.items() if points == top_score]
	print(f"Winner(s): {', '.join(winners)}")

	return scores


def main() -> None:
	print("Bug Fixer Game")
	print("==============")
	players = _collect_players()
	rounds_per_decider = _ask_int("How many decider cycles? ", 1)
	run_bug_fixer_game(players, rounds_per_decider=rounds_per_decider)


if __name__ == "__main__":
	main()
