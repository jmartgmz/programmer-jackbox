
import json
import os
import random
import tkinter as tk
from tkinter import messagebox, simpledialog
from dataclasses import dataclass
from typing import List, Optional


DEFAULT_JSON_PATH = "cards.json"
DEFAULT_TIME_LIMIT = 60
DEFAULT_PROMPTS_PER_ROUND = 3
DEFAULT_CYCLES = 1


@dataclass
class Player:
    name: str
    score: int = 0


class cardsAgainstHumanity:
    def __init__(self, root: tk.Tk, cards_path: str = DEFAULT_JSON_PATH):
        self.root = root
        self.root.title("Cards Against Humanity")
        self.root.geometry("1180x820")
        self.root.minsize(980, 700)
        self.root.configure(bg="#202124")

        self.cards_path = cards_path
        self.prompt_deck: List[str] = []
        self.discard_prompts: List[str] = []

        self.players: List[Player] = []
        self.decider_index = 0
        self.current_prompts: List[str] = []
        self.round_submissions: List[dict] = []
        self.pending_player_indices: List[int] = []
        self.current_submitter_index: Optional[int] = None

        self.cycles = DEFAULT_CYCLES
        self.prompts_per_round = DEFAULT_PROMPTS_PER_ROUND
        self.time_limit_seconds = DEFAULT_TIME_LIMIT
        self.total_rounds = 0
        self.completed_rounds = 0

        self.countdown_job = None
        self.reveal_job = None
        self.seconds_left = 0
        self.answer_widgets: List[tk.Text] = []
        self.locked_choice_index: Optional[int] = None

        self.main_frame = tk.Frame(self.root, bg="#202124")
        self.main_frame.pack(fill="both", expand=True)

        self.top_frame = tk.Frame(self.main_frame, bg="#202124")
        self.top_frame.pack(fill="x", padx=16, pady=(16, 10))

        self.title_label = tk.Label(
            self.top_frame,
            text="Cards Against Humanity",
            font=("Arial", 20, "bold"),
            fg="white",
            bg="#202124",
        )
        self.title_label.pack(anchor="w")

        self.info_label = tk.Label(
            self.top_frame,
            text="",
            font=("Arial", 11),
            fg="#d7dadc",
            bg="#202124",
            justify="left",
            wraplength=1080,
        )
        self.info_label.pack(anchor="w", pady=(6, 0))

        self.prompt_frame = tk.Frame(self.main_frame, bg="#202124")
        self.prompt_frame.pack(fill="x", padx=16, pady=10)

        self.prompt_title = tk.Label(
            self.prompt_frame,
            text="Current Prompts",
            font=("Arial", 14, "bold"),
            fg="white",
            bg="#202124",
        )
        self.prompt_title.pack(anchor="w")

        self.prompt_label = tk.Label(
            self.prompt_frame,
            text="",
            wraplength=1060,
            justify="left",
            font=("Arial", 14, "bold"),
            fg="white",
            bg="#111111",
            padx=20,
            pady=20,
            relief="groove",
            bd=2,
        )
        self.prompt_label.pack(fill="x", pady=(8, 0))

        self.center_frame = tk.Frame(self.main_frame, bg="#202124")
        self.center_frame.pack(fill="both", expand=True, padx=16, pady=10)

        self.left_panel = tk.Frame(self.center_frame, bg="#2c2f33", width=280)
        self.left_panel.pack(side="left", fill="y", padx=(0, 14))
        self.left_panel.pack_propagate(False)

        self.scoreboard_title = tk.Label(
            self.left_panel,
            text="Scoreboard",
            font=("Arial", 14, "bold"),
            fg="white",
            bg="#2c2f33",
        )
        self.scoreboard_title.pack(anchor="w", padx=14, pady=(14, 8))

        self.scoreboard_text = tk.Label(
            self.left_panel,
            text="",
            justify="left",
            anchor="nw",
            font=("Consolas", 12),
            fg="#f3f4f6",
            bg="#2c2f33",
        )
        self.scoreboard_text.pack(fill="both", expand=True, padx=14, pady=(0, 14))

        self.right_panel = tk.Frame(self.center_frame, bg="#202124")
        self.right_panel.pack(side="left", fill="both", expand=True)

        self.status_label = tk.Label(
            self.right_panel,
            text="",
            font=("Arial", 13, "bold"),
            fg="#8ab4f8",
            bg="#202124",
            justify="left",
            wraplength=800,
        )
        self.status_label.pack(anchor="w", pady=(0, 8))

        self.timer_label = tk.Label(
            self.right_panel,
            text="",
            font=("Arial", 12, "bold"),
            fg="#fbbc04",
            bg="#202124",
            justify="left",
        )
        self.timer_label.pack(anchor="w", pady=(0, 10))

        self.dynamic_container = tk.Frame(self.right_panel, bg="#202124")
        self.dynamic_container.pack(fill="both", expand=True)

        self.bottom_frame = tk.Frame(self.main_frame, bg="#202124")
        self.bottom_frame.pack(fill="x", padx=16, pady=(0, 16))

        self.next_button = tk.Button(
            self.bottom_frame,
            text="Start / Continue",
            font=("Arial", 12, "bold"),
            bg="#3b82f6",
            fg="white",
            activebackground="#2563eb",
            activeforeground="white",
            padx=18,
            pady=10,
            command=self.start_setup,
        )
        self.next_button.pack(side="right")

        self.load_prompts()
        self.show_welcome_screen()

    def load_prompts(self) -> None:
        if not os.path.exists(self.cards_path):
            messagebox.showerror(
                "Missing prompt file",
                f"Could not find {self.cards_path}. Put the JSON file next to the Python file and try again.",
            )
            self.root.destroy()
            return

        try:
            with open(self.cards_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            messagebox.showerror("Prompt file error", f"Could not load JSON file.\n\n{exc}")
            self.root.destroy()
            return

        raw_prompts = data.get("black_cards", []) or data.get("prompts", [])
        if not isinstance(raw_prompts, list):
            messagebox.showerror(
                "Prompt file error",
                "JSON must contain a 'black_cards' array (or a 'prompts' array) of prompt strings.",
            )
            self.root.destroy()
            return

        self.prompt_deck = [str(prompt).strip() for prompt in raw_prompts if str(prompt).strip()]
        if len(self.prompt_deck) < 10:
            messagebox.showerror(
                "Not enough prompts",
                "Please provide at least 10 prompts in the JSON file.",
            )
            self.root.destroy()
            return

        random.shuffle(self.prompt_deck)

    def clear_dynamic(self) -> None:
        for widget in self.dynamic_container.winfo_children():
            widget.destroy()

    def cancel_timers(self) -> None:
        if self.countdown_job is not None:
            self.root.after_cancel(self.countdown_job)
            self.countdown_job = None
        if self.reveal_job is not None:
            self.root.after_cancel(self.reveal_job)
            self.reveal_job = None

    def show_welcome_screen(self) -> None:
        self.cancel_timers()
        self.prompt_label.config(text="Press Start / Continue to set up a new game.")
        self.status_label.config(text="")
        self.timer_label.config(text="")
        self.scoreboard_text.config(text="No game started yet.")
        self.clear_dynamic()

        box = tk.Frame(self.dynamic_container, bg="#2c2f33", padx=20, pady=20)
        box.pack(fill="both", expand=True)

        msg = (
            "How it works:\n\n"
            "• Enter player names and host settings.\n"
            "• A decider is chosen and rotates in a circle.\n"
            "• Multiple prompts appear at once.\n"
            "• Every non-decider types one answer for each prompt.\n"
            "• After time runs out or everyone submits, the decider reviews anonymous submissions.\n"
            "• The decider picks the response set they agree with most.\n"
            "• The winner is revealed after a 10-second lock period and gets a point."
        )
        tk.Label(
            box,
            text=msg,
            font=("Arial", 14),
            fg="white",
            bg="#2c2f33",
            justify="left",
            anchor="nw",
        ).pack(anchor="nw")

    def start_setup(self) -> None:
        player_count = simpledialog.askinteger(
            "Players",
            "How many players? (3-8 recommended)",
            parent=self.root,
            minvalue=3,
            maxvalue=12,
        )
        if not player_count:
            return

        cycles = simpledialog.askinteger(
            "Rounds per player",
            "How many times should each person be the decider?",
            parent=self.root,
            minvalue=1,
            maxvalue=10,
            initialvalue=DEFAULT_CYCLES,
        )
        if not cycles:
            return

        time_limit = simpledialog.askinteger(
            "Time limit",
            "How many seconds should each player have to answer?",
            parent=self.root,
            minvalue=10,
            maxvalue=600,
            initialvalue=DEFAULT_TIME_LIMIT,
        )
        if not time_limit:
            return

        prompts_per_round = simpledialog.askinteger(
            "Prompts per round",
            "How many prompts should be shown at once?",
            parent=self.root,
            minvalue=1,
            maxvalue=8,
            initialvalue=DEFAULT_PROMPTS_PER_ROUND,
        )
        if not prompts_per_round:
            return

        names: List[str] = []
        for i in range(player_count):
            name = simpledialog.askstring(
                "Player name",
                f"Enter name for Player {i + 1}:",
                parent=self.root,
            )
            if not name:
                name = f"Player {i + 1}"
            names.append(name.strip() or f"Player {i + 1}")

        self.reset_game(names, cycles, time_limit, prompts_per_round)
        self.start_round()

    def reset_game(
        self,
        names: List[str],
        cycles: int,
        time_limit: int,
        prompts_per_round: int,
    ) -> None:
        self.cancel_timers()
        self.players = [Player(name=n) for n in names]
        self.cycles = cycles
        self.time_limit_seconds = time_limit
        self.prompts_per_round = prompts_per_round
        self.decider_index = 0
        self.current_prompts = []
        self.round_submissions = []
        self.pending_player_indices = []
        self.current_submitter_index = None
        self.total_rounds = len(self.players) * cycles
        self.completed_rounds = 0
        self.locked_choice_index = None

        self.prompt_deck.extend(self.discard_prompts)
        self.discard_prompts.clear()
        random.shuffle(self.prompt_deck)

        for player in self.players:
            player.score = 0

        self.next_button.config(text="New Game", command=self.start_setup, state="normal")
        self.update_scoreboard()

    def draw_prompt(self) -> str:
        if not self.prompt_deck:
            if not self.discard_prompts:
                return "[No more prompts]"
            self.prompt_deck = self.discard_prompts[:]
            self.discard_prompts.clear()
            random.shuffle(self.prompt_deck)
        return self.prompt_deck.pop()

    def update_scoreboard(self) -> None:
        lines = []
        for idx, player in enumerate(self.players):
            decider_tag = "  <- Decider" if idx == self.decider_index else ""
            lines.append(f"{player.name}: {player.score}{decider_tag}")
        lines.append("")
        lines.append(f"Round: {self.completed_rounds + 1} / {self.total_rounds}")
        lines.append(f"Time limit: {self.time_limit_seconds}s")
        lines.append(f"Prompts this round: {self.prompts_per_round}")
        self.scoreboard_text.config(text="\n".join(lines))

    def format_prompts(self) -> str:
        return "\n\n".join(
            f"{idx + 1}. {prompt}" for idx, prompt in enumerate(self.current_prompts)
        )

    def start_round(self) -> None:
        if self.completed_rounds >= self.total_rounds:
            self.show_final_winner()
            return

        self.cancel_timers()
        self.round_submissions = []
        self.current_prompts = [self.draw_prompt() for _ in range(self.prompts_per_round)]
        self.prompt_label.config(text=self.format_prompts())

        self.pending_player_indices = [
            i for i in range(len(self.players)) if i != self.decider_index
        ]

        decider_name = self.players[self.decider_index].name
        self.info_label.config(
            text=(
                f"Decider this round: {decider_name}. Pass the computer around so each "
                "non-decider can privately type one answer for every visible prompt."
            )
        )

        self.update_scoreboard()
        self.prompt_next_submission()

    def prompt_next_submission(self) -> None:
        self.cancel_timers()
        self.answer_widgets = []

        if not self.pending_player_indices:
            self.timer_label.config(text="")
            self.show_decider_pick_screen()
            return

        self.current_submitter_index = self.pending_player_indices.pop(0)
        player = self.players[self.current_submitter_index]

        self.clear_dynamic()
        self.status_label.config(
            text=(
                f"{player.name}, it is your turn. Type an answer for every prompt "
                "before the timer runs out."
            )
        )

        instructions = tk.Label(
            self.dynamic_container,
            text="Your answers are private. Fill in all boxes below, then click Submit Answers.",
            wraplength=800,
            justify="left",
            font=("Arial", 12),
            fg="#d7dadc",
            bg="#202124",
        )
        instructions.pack(anchor="w", pady=(0, 12))

        container = tk.Frame(self.dynamic_container, bg="#202124")
        container.pack(fill="both", expand=True)

        for idx, prompt in enumerate(self.current_prompts):
            card = tk.Frame(container, bg="#2c2f33", padx=14, pady=14)
            card.pack(fill="x", pady=8)

            tk.Label(
                card,
                text=f"Prompt {idx + 1}: {prompt}",
                font=("Arial", 12, "bold"),
                fg="white",
                bg="#2c2f33",
                justify="left",
                wraplength=760,
                anchor="w",
            ).pack(anchor="w")

            answer_box = tk.Text(
                card,
                height=3,
                font=("Arial", 12),
                wrap="word",
                bg="white",
                fg="black",
                relief="solid",
                bd=1,
            )
            answer_box.pack(fill="x", pady=(10, 0))
            self.answer_widgets.append(answer_box)

        submit_btn = tk.Button(
            self.dynamic_container,
            text="Submit Answers",
            font=("Arial", 12, "bold"),
            bg="#22c55e",
            fg="white",
            activebackground="#16a34a",
            activeforeground="white",
            padx=16,
            pady=10,
            command=self.submit_text_answers,
        )
        submit_btn.pack(anchor="e", pady=(12, 0))

        self.seconds_left = self.time_limit_seconds
        self.update_timer_label()
        self.tick_countdown()

    def update_timer_label(self) -> None:
        self.timer_label.config(text=f"Time remaining: {self.seconds_left} seconds")

    def tick_countdown(self) -> None:
        self.update_timer_label()
        if self.seconds_left <= 0:
            self.submit_text_answers(auto_submit=True)
            return
        self.seconds_left -= 1
        self.countdown_job = self.root.after(1000, self.tick_countdown)

    def submit_text_answers(self, auto_submit: bool = False) -> None:
        if self.current_submitter_index is None:
            return

        self.cancel_timers()
        answers = [widget.get("1.0", "end").strip() for widget in self.answer_widgets]

        if not auto_submit and any(not answer for answer in answers):
            messagebox.showwarning(
                "Missing answer",
                "Please enter an answer for every prompt before submitting.",
            )
            self.seconds_left = max(1, self.seconds_left)
            self.tick_countdown()
            return

        cleaned_answers = [answer if answer else "[No answer submitted]" for answer in answers]
        self.round_submissions.append(
            {
                "player_index": self.current_submitter_index,
                "answers": cleaned_answers,
            }
        )
        random.shuffle(self.round_submissions)

        if auto_submit:
            player_name = self.players[self.current_submitter_index].name
            messagebox.showinfo(
                "Time is up",
                f"{player_name}'s turn ran out of time. Their current answers were submitted.",
            )

        self.prompt_next_submission()

    def show_decider_pick_screen(self) -> None:
        self.cancel_timers()
        decider = self.players[self.decider_index]
        self.clear_dynamic()
        self.status_label.config(
            text=f"{decider.name}, choose the anonymous response set you agree with most."
        )
        self.timer_label.config(text="")

        picks_canvas = tk.Canvas(self.dynamic_container, bg="#202124", highlightthickness=0)
        scrollbar = tk.Scrollbar(
            self.dynamic_container,
            orient="vertical",
            command=picks_canvas.yview,
        )
        scroll_frame = tk.Frame(picks_canvas, bg="#202124")

        scroll_frame.bind(
            "<Configure>",
            lambda event: picks_canvas.configure(scrollregion=picks_canvas.bbox("all")),
        )

        picks_canvas.create_window((0, 0), window=scroll_frame, anchor="nw")
        picks_canvas.configure(yscrollcommand=scrollbar.set)

        picks_canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        for idx, submission in enumerate(self.round_submissions):
            card = tk.Frame(scroll_frame, bg="#2c2f33", padx=16, pady=16)
            card.pack(fill="x", pady=8)

            tk.Label(
                card,
                text=f"Anonymous Submission {idx + 1}",
                font=("Arial", 13, "bold"),
                fg="white",
                bg="#2c2f33",
            ).pack(anchor="w")

            lines = []
            for prompt_idx, answer in enumerate(submission["answers"]):
                lines.append(f"{prompt_idx + 1}. {answer}")

            tk.Label(
                card,
                text="\n\n".join(lines),
                font=("Arial", 12),
                fg="#f3f4f6",
                bg="#2c2f33",
                justify="left",
                wraplength=760,
            ).pack(anchor="w", pady=(10, 12))

            tk.Button(
                card,
                text="Choose This Submission",
                font=("Arial", 11, "bold"),
                bg="#3b82f6",
                fg="white",
                activebackground="#2563eb",
                activeforeground="white",
                padx=12,
                pady=8,
                command=lambda pick_idx=idx: self.begin_choice_lock(pick_idx),
            ).pack(anchor="e")

    def begin_choice_lock(self, submission_index: int) -> None:
        self.locked_choice_index = submission_index
        chosen = self.round_submissions[submission_index]

        self.clear_dynamic()
        self.status_label.config(
            text="Choice locked. The selected submission will be confirmed in 10 seconds."
        )
        self.timer_label.config(text="Revealing winner in 10 seconds...")

        panel = tk.Frame(self.dynamic_container, bg="#2c2f33", padx=20, pady=20)
        panel.pack(fill="both", expand=True)

        tk.Label(
            panel,
            text="Selected Submission",
            font=("Arial", 18, "bold"),
            fg="white",
            bg="#2c2f33",
        ).pack(anchor="w")

        chosen_text = []
        for idx, answer in enumerate(chosen["answers"]):
            chosen_text.append(f"Prompt {idx + 1} answer: {answer}")

        tk.Label(
            panel,
            text="\n\n".join(chosen_text),
            font=("Arial", 13),
            fg="#f3f4f6",
            bg="#2c2f33",
            justify="left",
            wraplength=780,
        ).pack(anchor="w", pady=(12, 0))

        self.reveal_job = self.root.after(10000, self.finalize_winner)

    def finalize_winner(self) -> None:
        self.reveal_job = None
        if self.locked_choice_index is None:
            return

        chosen = self.round_submissions[self.locked_choice_index]
        winner = self.players[chosen["player_index"]]
        winner.score += 1

        for prompt in self.current_prompts:
            self.discard_prompts.append(prompt)

        self.completed_rounds += 1
        self.update_scoreboard()
        self.timer_label.config(text="")

        answers_text = "\n\n".join(
            f"{idx + 1}. {answer}" for idx, answer in enumerate(chosen["answers"])
        )
        messagebox.showinfo(
            "Round Winner",
            f"{winner.name} wins the round and gets 1 point!\n\nWinning answers:\n{answers_text}",
        )

        self.locked_choice_index = None
        self.decider_index = (self.decider_index + 1) % len(self.players)

        if self.completed_rounds >= self.total_rounds:
            self.show_final_winner()
        else:
            self.start_round()

    def show_final_winner(self) -> None:
        self.cancel_timers()
        self.clear_dynamic()

        top_score = max(player.score for player in self.players)
        winners = [player.name for player in self.players if player.score == top_score]
        winners_text = ", ".join(winners)

        if len(winners) == 1:
            title = f"{winners_text} wins the game!"
        else:
            title = f"Tie game: {winners_text}"

        self.status_label.config(text="Game over.")
        if self.current_prompts:
            self.prompt_label.config(text=self.format_prompts())
        else:
            self.prompt_label.config(text="Game finished.")
        self.timer_label.config(text="")

        panel = tk.Frame(self.dynamic_container, bg="#2c2f33", padx=20, pady=20)
        panel.pack(fill="both", expand=True)

        tk.Label(
            panel,
            text=title,
            font=("Arial", 24, "bold"),
            fg="white",
            bg="#2c2f33",
        ).pack(anchor="center", pady=(0, 12))

        standings = "\n".join(
            f"{player.name}: {player.score}"
            for player in sorted(self.players, key=lambda p: p.score, reverse=True)
        )

        tk.Label(
            panel,
            text=(
                f"Final standings:\n\n{standings}\n\n"
                "Click 'New Game' to play again."
            ),
            font=("Arial", 14),
            fg="#f3f4f6",
            bg="#2c2f33",
            justify="left",
            wraplength=760,
        ).pack(anchor="center")


def main() -> None:
    root = tk.Tk()
    cardsAgainstHumanity(root)
    root.mainloop()


if __name__ == "__main__":
    main()
