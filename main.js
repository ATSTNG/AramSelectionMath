
var binom_coefs = [ [1] ];
var binom_coefs_size = 500;

for (var i = 0; i < binom_coefs_size; i++) {
    var new_row = [1];

    for (var j = 0; j+1 <= i; j++) {
        new_row.push(binom_coefs[i][j] + binom_coefs[i][j+1]);
    }

    new_row.push(1);

    binom_coefs.push(new_row);
}

function c_func(n, k) {
    if (k < 0) return 0;
    if (n < 0) return 0;
    if (k > n) return 0;
    
    return binom_coefs[n][k];
}

function hypergeom_func(total, total_split, sample, sample_split) {
    var total_comp = total - total_split;
    var sample_comp = sample - sample_split;

    //console.log('HG', total, total_split, sample, sample_split );

    return c_func(total_split, sample_split) * c_func(total_comp, sample_comp) / c_func(total, sample);
}

function get_string(s, ra='', rb='', rc='', rd='', re='') {
    return document.getElementById('s_' + s).innerText
        .replace('AAA', ra)
        .replace('BBB', rb)
        .replace('CCC', rc)
        .replace('DDD', rd)
        .replace('EEE', re);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function immediate_delay() {
    return new Promise(resolve => setTimeout(resolve, 5));
}

function format_probability_html(p) {
    var r = Math.min(255, Math.round(255 * 2 * (1-p)));
    var g = Math.min(255, Math.round(255 * 2 * p));
    var b = 0;

    return "<span style='color: rgb(" + r + ", " + g + ", " + b + ");'>" + (p * 100).toFixed(2) + "%</span>";
}

function format_probability_text(p) {
    return "" + (p * 100).toFixed(2) + "%";
}

class ChampionSelectionModel {
    constructor (params) {
        this.params = params;
    }

    get precision_cutoff() {
        return 1e-9;
    }
    get total_games() {
        return this.params.total_games;
    }
    get total_champions() {
        return this.params.total_champions;
    }
    get target_streak() {
        return this.params.target_streak;
    }
    get upgrade_pool() {
        return this.params.upgrade_pool;
    }
    get draft_pool() {
        return this.params.draft_pool;
    }
    get reset_on_failure() {
        return this.params.reset_on_failure;
    }

    get max_state_position() {
        return this.target_streak;
    }

    compute() {
        this.timestamp_begin = performance.now();
        this.states_in_peak = 0;
        this.transitions_in_total = 0;

        this.result = new Array(this.total_games + 1).fill(0);
        this.success_probability = 0;
        this.current_layer = {};
        this.next_layer = {};

        this.current_layer[this.zero_state] = 1;

        console.log(this.current_layer);

        var draft_pool_left = 0;

        for (var current_game = 1; current_game <= this.total_games; current_game++) {
            draft_pool_left += this.draft_pool;
            var draft_pool_for_current_game = Math.floor(draft_pool_left);
            draft_pool_left -= draft_pool_for_current_game;

            for (var encoded_state in this.current_layer) {
                var state = JSON.parse('[' + encoded_state + ']');
                var next_state = this.empty_state;

                this.expand_state(
                    state,
                    next_state,
                    this.max_state_position - 1,
                    this.current_layer[state],
                    this.total_champions,
                    this.upgrade_pool,
                    draft_pool_for_current_game
                );
            }

            console.log(this.next_layer);
            console.log(current_game, this.success_probability);

            this.result[current_game] = this.success_probability;

            this.current_layer = this.next_layer;
            this.next_layer = {};

            this.states_in_peak = Math.max(this.states_in_peak, Object.keys(this.current_layer).length);
        }

        this.timestamp_end = performance.now();
        this.duration = this.timestamp_end - this.timestamp_begin;

        console.log('duration', this.duration, 'states_in_peak', this.states_in_peak);
    }

    expand_state(state, next_state, state_position, probability, total_left, upgrade_left, draft_left) {

        if (probability < this.precision_cutoff) {
            return;
        }

        if (state_position == -1) {
            this.apply_state(next_state, probability);
            return;
        }

        var current_group_champs = state[state_position];
        var max_matched_champs = Math.min(draft_left, current_group_champs);

        for (var matched_champs = 0; matched_champs <= max_matched_champs; matched_champs++) {
            var transition_prob = hypergeom_func(total_left, current_group_champs, draft_left, matched_champs);

            var champs_to_upgrade = Math.min(upgrade_left, matched_champs);
            var champs_to_fail = current_group_champs - champs_to_upgrade;
            var upgrade_position = state_position + 1;
            var fail_position = (this.reset_on_failure ? 0 : state_position);

            // apply
            next_state[upgrade_position] += champs_to_upgrade;
            next_state[fail_position]    += champs_to_fail;

            this.expand_state(
                state,
                next_state,
                state_position - 1,
                probability * transition_prob,
                total_left - current_group_champs,
                upgrade_left - champs_to_upgrade,
                draft_left - matched_champs
            );

            // rollback
            next_state[upgrade_position] -= champs_to_upgrade;
            next_state[fail_position]    -= champs_to_fail;

        }
    }

    apply_state(next_state, probability) {
        if (probability < this.precision_cutoff) {
            return;
        }

        if (next_state[this.target_streak] > 0) {
            this.success_probability += probability;
            return;
        }

        if ( !this.next_layer.hasOwnProperty(next_state)) {
            this.next_layer[next_state] = 0;
        }

        this.next_layer[next_state] += probability;

        this.transitions_in_total += 1;
    }

    get empty_state() {
        return new Array(this.target_streak + 1).fill(0);
    }

    get zero_state() {
        var state = new Array(this.target_streak + 1).fill(0);
        
        state[0] = this.total_champions;

        return state;
    }
}

class FavoriteChampionsTable {
    constructor(container_id, strings, total_champions=161) {
        this.container =  document.getElementById(container_id);
        this.status_label = this.container.children[0];
        this.table = this.container.children[1];

        this.strings = strings;

        this.total_champions = total_champions;
    }

    compute() {
        this.reset();

        this.timestamp_begin = performance.now();
        this.states_in_peak = 0;
        this.transitions_in_total = 0;
        
        this.draft_values = [5,6,7,8,9,10,11,12,13,14,15];
        this.favorite_values = [1,2,3,4,5,7,10,15,20,25,30,40];

        this.results = [];
        for (const draft_value of this.draft_values) {
            var row = [];
            for (const favorite_value of this.favorite_values) {
                row.push(1 - c_func(this.total_champions - favorite_value, draft_value) / c_func(this.total_champions, draft_value));
                //row.push(1 - c_func(this.total_champions - draft_value, favorite_value) / c_func(this.total_champions, favorite_value));
            }
            this.results.push(row);
        }
        
        this.timestamp_end = performance.now();
        this.duration = this.timestamp_end - this.timestamp_begin;

        this.render();
    }

    reset() {
        this.status_label.innerText = get_string('comp_in_progress');
        this.table.tHead.innerHTML = '';
        this.table.tBodies[0].innerHTML = '';
    }

    render() {
        this.status_label.innerText = get_string('comp_complete_b', this.total_champions, Math.round(this.duration));

        // head
        var tr = '<tr>';
        tr += '<th>X \\ Y</th>';
        for (const favorite_value of this.favorite_values) {
            tr += '<th>' + get_string(this.strings.col, favorite_value) + '</th>';
        }
        tr += '</tr>';

        this.table.tHead.innerHTML = tr;
        
        //  body
        this.table.tBodies[0].innerHTML = '';
        
        for (var i = 0; i < this.results.length; i++) {
            var tr = '<tr>';
            tr += '<td>' + get_string(this.strings.row, this.draft_values[i], this.draft_values[i]-5) + '</td>';
            for (var j = 0; j < this.results[0].length; j++) {
                var prob = this.results[i][j];

                tr += '<td title="' + get_string(this.strings.cell_title, format_probability_text(prob), this.favorite_values[j], this.draft_values[i]) + '">' + 
                        format_probability_html(prob) + 
                    '</td>';
            }
            tr += '</tr>';
            
            this.table.tBodies[0].innerHTML += tr;
        }
    }
}

class ChampionSelectionTable {
    constructor(container_id, model_params, strings, streak_max, draft_pool_fixed=1, draft_pool_reroll_coef=0, total_champions=161, rerolls_per_game=1.224) {
        this.container =  document.getElementById(container_id);
        this.status_label = this.container.children[0];
        this.table = this.container.children[1];

        this.model_params = model_params;
        this.strings = strings;
        this.streak_max = streak_max;
        this.draft_pool_fixed = draft_pool_fixed;
        this.draft_pool_reroll_coef = draft_pool_reroll_coef;
        this.total_champions = total_champions;
        this.rerolls_per_game = rerolls_per_game;
    }

    compute() {
        this.reset();

        this.timestamp_begin = performance.now();
        this.states_in_peak = 0;
        this.transitions_in_total = 0;

        this.model_params.total_champions = this.total_champions;
        this.model_params.draft_pool = this.draft_pool_fixed + this.draft_pool_reroll_coef * this.rerolls_per_game;
        
        this.results = [];
        for (var streak = 2; streak <= this.streak_max; streak++) {
            this.model_params.target_streak = streak;

            var cur_model = new ChampionSelectionModel(this.model_params);
            cur_model.compute();

            this.results.push(cur_model.result);

            this.states_in_peak = Math.max(this.states_in_peak, cur_model.states_in_peak);
            this.transitions_in_total += cur_model.transitions_in_total;
        }
        
        this.timestamp_end = performance.now();
        this.duration = this.timestamp_end - this.timestamp_begin;

        this.render();
    }

    reset() {
        this.status_label.innerText = get_string('comp_in_progress');
        this.table.tHead.innerHTML = '';
        this.table.tBodies[0].innerHTML = '';
    }

    render() {
        console.log(this.results);

        this.status_label.innerText = get_string(
            'comp_complete',
            this.total_champions,
            this.rerolls_per_game,
            Math.round(this.duration),
            this.states_in_peak,
            this.transitions_in_total,
        );

        // head
        var tr = '<tr>';
        tr += '<th>X \\ Y</th>';
        for (var streak = 2; streak <= this.streak_max; streak++) {
            tr += '<th>' + get_string(this.strings.col, streak) + '</th>';
        }
        tr += '</tr>';

        this.table.tHead.innerHTML = tr;
        
        //  body
        this.table.tBodies[0].innerHTML = '';
        
        for (var games = 1; games < this.results[0].length; games++) {
            var tr = '<tr>';
            tr += '<td>' + get_string(this.strings.row, games) + '</td>';
            for (var streak = 2; streak <= this.streak_max; streak++) {
                var prob = this.results[streak-2][games];

                tr += '<td title="' + get_string(this.strings.cell_title, format_probability_text(prob), streak, games) + '">' + format_probability_html(prob) + '</td>';
            }
            tr += '</tr>';
            
            this.table.tBodies[0].innerHTML += tr;
        }
    }
}

class ChampionSelectionDocument {
    constructor() {
        this.status_label = document.getElementById('control_form_status_label');
        this.recalculate_button = document.getElementById('recalculate_button');
        this.input_champions_total = document.getElementById('input_champions_total');
        this.input_rerolls_per_game = document.getElementById('input_rerolls_per_game');

        this.tables = [
            new FavoriteChampionsTable(
                'table_favorite_champions',
                {
                    row: 'x_in_lobby_rerolls',
                    col: 'x',
                    cell_title: 'title_b1',
                },
            ),

            new ChampionSelectionTable(
                'table_play_against_row',
                {
                    total_games: 20,
                    upgrade_pool: 5,
                    reset_on_failure: true,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_a_row',
                    cell_title: 'title_c1',
                },
                5, /* max_streak */
                5, /* draft_pool_fixed */
                5, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_play_against_sum',
                {
                    total_games: 15,
                    upgrade_pool: 5,
                    reset_on_failure: false,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c2',
                },
                5, /* max_streak */
                5, /* draft_pool_fixed */
                5, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_play_as_row',
                {
                    total_games: 20,
                    upgrade_pool: 1,
                    reset_on_failure: true,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_a_row',
                    cell_title: 'title_c3',
                },
                5, /* max_streak */
                5, /* draft_pool_fixed */
                5, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_play_as_sum',
                {
                    total_games: 20,
                    upgrade_pool: 1,
                    reset_on_failure: false,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c4',
                },
                5, /* max_streak */
                5, /* draft_pool_fixed */
                5, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_roll_row',
                {
                    total_games: 15,
                    upgrade_pool: 9999,
                    reset_on_failure: true,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_a_row',
                    cell_title: 'title_c5',
                },
                4, /* max_streak */
                1, /* draft_pool_fixed */
                1, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_roll_sum',
                {
                    total_games: 20,
                    upgrade_pool: 9999,
                    reset_on_failure: false,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c6',
                },
                5, /* max_streak */
                1, /* draft_pool_fixed */
                1, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_roll_and_play_row',
                {
                    total_games: 15,
                    upgrade_pool: 1,
                    reset_on_failure: true,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_a_row',
                    cell_title: 'title_c7',
                },
                4, /* max_streak */
                1, /* draft_pool_fixed */
                1, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_roll_and_play_sum',
                {
                    total_games: 15,
                    upgrade_pool: 1,
                    reset_on_failure: false,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c8',
                },
                4, /* max_streak */
                1, /* draft_pool_fixed */
                1, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_pure_random_row',
                {
                    total_games: 15,
                    upgrade_pool: 1,
                    reset_on_failure: true,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c9',
                },
                4, /* max_streak */
                1, /* draft_pool_fixed */
                0, /* draft_pool_reroll_coef */
            ),
            
            new ChampionSelectionTable(
                'table_pure_random_sum',
                {
                    total_games: 15,
                    upgrade_pool: 1,
                    reset_on_failure: false,
                },
                {
                    row: 'x_games_played',
                    col: 'x_in_total',
                    cell_title: 'title_c10',
                },
                4, /* max_streak */
                1, /* draft_pool_fixed */
                0, /* draft_pool_reroll_coef */
            ),
        ];
    }

    compute() {
        this.status_label.innerText = get_string('comp_in_progress');
        
        this.recalculate_button.setAttribute('disabled', 'true');
        this.input_champions_total.setAttribute('disabled', 'true');
        this.input_rerolls_per_game.setAttribute('disabled', 'true');

        this.run_async_computations().then(async function() {
            this.status_label.innerText = get_string(
                'comp_complete',
                this.input_champions_total.value,
                this.input_rerolls_per_game.value,
                Math.round(this.duration),
                this.states_in_peak,
                this.transitions_in_total
            );

            this.recalculate_button.removeAttribute('disabled');
            this.input_champions_total.removeAttribute('disabled');
            this.input_rerolls_per_game.removeAttribute('disabled');
        }.bind(this));
    }

    run_async_computations() {
        this.timestamp_begin = performance.now();
        this.states_in_peak = 0;
        this.transitions_in_total = 0;

        this.reset();

        var planned_computations = Promise.resolve();
        
        for (const cur_table of this.tables) {
            planned_computations = planned_computations.then(immediate_delay);

            planned_computations = planned_computations
                .then(async function() {
                    cur_table.total_champions = Number(this.input_champions_total.value);
                    cur_table.rerolls_per_game = Number(this.input_rerolls_per_game.value);
                    cur_table.compute();

                    this.states_in_peak = Math.max(this.states_in_peak, cur_table.states_in_peak);
                    this.transitions_in_total += cur_table.transitions_in_total;
                }.bind(this));
        }

        planned_computations = planned_computations.then(async function() {
            this.timestamp_end = performance.now();
            this.duration = this.timestamp_end - this.timestamp_begin;
        }.bind(this));

        return planned_computations;
    }

    reset() {
        for (var cur_table of this.tables) {
            cur_table.reset();
        }
    }
}

document.getElementById('general_information_title').addEventListener('click', function() {
    var general_information_title = document.getElementById('general_information_title');
    var general_information_hint = document.getElementById('general_information_hint');
    var general_information_container = document.getElementById('general_information_container');

    general_information_title.classList.remove('expandable');
    general_information_hint.innerHTML = '';
    general_information_container.style.display = 'block';
});

document.getElementById('approach_details_title').addEventListener('click', function() {
    var approach_details_title = document.getElementById('approach_details_title');
    var approach_details_hint = document.getElementById('approach_details_hint');
    var approach_details_container = document.getElementById('approach_details_container');

    approach_details_title.classList.remove('expandable');
    approach_details_hint.innerHTML = '';
    approach_details_container.style.display = 'block';
});


var champion_select_document = new ChampionSelectionDocument();

document.getElementById('recalculate_button').addEventListener('click', function() {
    champion_select_document.compute();
});

champion_select_document.compute();


/*
var test_model = new ChampionSelectionModel({
    total_games: 3,
    total_champions: 161,
    target_streak: 3,
    upgrade_pool: 5,
    draft_pool: 15,
    reset_on_failure: true,
});

test_model.compute();


*/

console.log(1 - c_func(161-10, 10) / c_func(161, 10) );