from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class PromptCard:
	prompt: str
	responses: int


@dataclass(frozen=True)
class SolutionCard:
	response: str


def _load_json(json_path: Path) -> list[dict]:
	with json_path.open("r", encoding="utf-8") as source:
		data = json.load(source)

	if not isinstance(data, list):
		raise ValueError(f"Expected a list in {json_path.name}")

	return data


def load_prompt_cards(base_dir: Path | None = None) -> List[PromptCard]:
	root = base_dir or Path(__file__).resolve().parent
	raw = _load_json(root / "bugPrompts.json")

	cards: List[PromptCard] = []
	for entry in raw:
		prompt = str(entry.get("prompt", "")).strip()
		responses = int(entry.get("responses", 1))

		if not prompt:
			continue
		if responses < 1:
			raise ValueError("Prompt responses must be at least 1")

		cards.append(PromptCard(prompt=prompt, responses=responses))

	if not cards:
		raise ValueError("No prompt cards were loaded")

	return cards


def load_solution_cards(base_dir: Path | None = None) -> List[SolutionCard]:
	root = base_dir or Path(__file__).resolve().parent
	raw = _load_json(root / "solutionCards.json")

	cards: List[SolutionCard] = []
	for entry in raw:
		response = str(entry.get("response", "")).strip()
		if response:
			cards.append(SolutionCard(response=response))

	if not cards:
		raise ValueError("No solution cards were loaded")

	return cards


def draw_unique_hand(solution_deck: List[SolutionCard], hand_size: int = 5) -> List[SolutionCard]:
	if hand_size < 1:
		raise ValueError("Hand size must be at least 1")
	if len(solution_deck) < hand_size:
		raise ValueError("Not enough solution cards to draw a unique hand")

	return random.sample(solution_deck, hand_size)


def choose_prompt(prompts: List[PromptCard], used_indices: set[int]) -> tuple[int, PromptCard]:
	if len(used_indices) == len(prompts):
		used_indices.clear()

	available_indices = [idx for idx in range(len(prompts)) if idx not in used_indices]
	selected_index = random.choice(available_indices)
	used_indices.add(selected_index)
	return selected_index, prompts[selected_index]
